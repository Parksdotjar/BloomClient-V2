use std::io::Cursor;
use std::path::{Component, Path, PathBuf, Prefix};
use std::ptr::null_mut;
use std::slice;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    codecs::png::PngEncoder, imageops::FilterType, ExtendedColorType, ImageEncoder, ImageFormat,
    ImageReader, Limits, RgbaImage,
};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::async_runtime;
use tokio::time::timeout;
use windows::{
    core::{Interface, GUID, HSTRING},
    ApplicationModel::AppInfo,
    Foundation::Size,
    Storage::Streams::DataReader,
    Win32::{
        Foundation::{PROPERTYKEY, SIZE},
        Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDIBits,
            GetObjectW, SelectObject, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
            HBITMAP, HDC, HGDIOBJ,
        },
        System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED},
        UI::{
            Shell::{
                IShellItem2, IShellItemImageFactory, SHCreateItemFromParsingName,
                SHDefExtractIconW, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
            },
            WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON},
        },
    },
};

const ICON_SIZE: u32 = 96;
const APP_USER_MODEL_ID: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
    pid: 5,
};
const LINK_TARGET_PARSING_PATH: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0xb9b4b3fc_2b51_4a42_b5d8_324146afcf25),
    pid: 2,
};
const MAX_ICON_BYTES: u32 = 1024 * 1024;
const ICON_TIMEOUT: Duration = Duration::from_secs(2);

pub(crate) async fn read_app_icon(source_app_id: &str) -> Option<String> {
    if source_app_id.is_empty() || source_app_id.len() > 256 || source_app_id.contains('\0') {
        return None;
    }

    let app_id = source_app_id.to_owned();
    if let Some(icon) = timeout(
        ICON_TIMEOUT,
        async_runtime::spawn_blocking(move || registered_app_icon(&app_id)),
    )
    .await
    .ok()
    .and_then(Result::ok)
    .flatten()
    {
        return Some(icon);
    }

    let bytes = timeout(ICON_TIMEOUT, package_logo(source_app_id))
        .await
        .ok()??;
    async_runtime::spawn_blocking(move || decode_logo(&bytes))
        .await
        .ok()?
}

fn registered_app_icon(app_id: &str) -> Option<String> {
    if let Some(icon) = shell_app_icon(app_id) {
        return encode_png(&icon);
    }

    let path = unique_running_executable(app_id)?;
    encode_png(&extract_executable_icon(&path)?)
}

fn shell_identity(app_id: &str) -> bool {
    !app_id.is_empty()
        && app_id.len() <= 128
        && !app_id.contains("..")
        && app_id.bytes().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-' | b'!' | b';' | b'{' | b'}')
        })
}

struct ShellApartment;

impl ShellApartment {
    fn open() -> Option<Self> {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().ok()? };
        Some(Self)
    }
}

impl Drop for ShellApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() }
    }
}

fn shell_string(item: &IShellItem2, key: &PROPERTYKEY) -> Option<String> {
    unsafe {
        let value = item.GetString(key).ok()?;
        let text = value.to_string().ok();
        CoTaskMemFree(Some(value.0.cast()));
        text
    }
}

fn registered_app_item(app_id: &str) -> Option<IShellItem2> {
    if !shell_identity(app_id) {
        return None;
    }
    let name = HSTRING::from(format!(r"shell:AppsFolder\{app_id}"));
    let item: IShellItem2 = unsafe { SHCreateItemFromParsingName(&name, None) }.ok()?;
    shell_string(&item, &APP_USER_MODEL_ID)?
        .eq_ignore_ascii_case(app_id)
        .then_some(item)
}

pub(crate) fn registered_desktop_executable(app_id: &str) -> Option<PathBuf> {
    let _apartment = ShellApartment::open()?;
    let item = registered_app_item(app_id)?;
    let path = PathBuf::from(shell_string(&item, &LINK_TARGET_PARSING_PATH)?);
    local_executable(&path).then_some(path)
}

fn shell_app_icon(app_id: &str) -> Option<RgbaImage> {
    let _apartment = ShellApartment::open()?;
    let item = registered_app_item(app_id)?;
    unsafe {
        // ICONONLY selects the installed app icon, avoiding media thumbnail
        // and album art. Ask the Shell for a HiDPI image with no tile backplate.
        let factory = item.cast::<IShellItemImageFactory>().ok()?;
        let size = SIZE {
            cx: ICON_SIZE as i32,
            cy: ICON_SIZE as i32,
        };
        let bitmap = ShellBitmap(
            factory
                .GetImage(size, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK)
                .ok()?,
        );
        bitmap.to_image()
    }
}

struct ShellBitmap(HBITMAP);

impl ShellBitmap {
    fn to_image(&self) -> Option<RgbaImage> {
        let mut metadata = BITMAP::default();
        unsafe {
            if GetObjectW(
                self.0.into(),
                size_of::<BITMAP>() as i32,
                Some((&mut metadata as *mut BITMAP).cast()),
            ) != size_of::<BITMAP>() as i32
            {
                return None;
            }

            let width = u32::try_from(metadata.bmWidth).ok()?;
            let height = metadata.bmHeight.unsigned_abs();
            if !(1..=512).contains(&width) || !(1..=512).contains(&height) {
                return None;
            }

            let mut info = bitmap_info(width, height);
            let mut pixels = vec![0; (width * height * 4) as usize];
            let dc = CreateCompatibleDC(None);
            if dc.is_invalid() {
                return None;
            }
            let lines = GetDIBits(
                dc,
                self.0,
                0,
                height,
                Some(pixels.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            );
            let _ = DeleteDC(dc);
            if lines != height as i32 {
                return None;
            }

            let has_alpha = pixels.chunks_exact(4).any(|pixel| pixel[3] != 0);
            if !has_alpha && !pixels.iter().any(|value| *value != 0) {
                return None;
            }
            for pixel in pixels.chunks_exact_mut(4) {
                pixel.swap(0, 2);
                if has_alpha {
                    let alpha = u16::from(pixel[3]);
                    for channel in &mut pixel[..3] {
                        *channel = if alpha == 0 {
                            0
                        } else {
                            ((u16::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8
                        };
                    }
                } else {
                    pixel[3] = 255;
                }
            }

            let image = RgbaImage::from_raw(width, height, pixels)?;
            Some(normalize_icon(image))
        }
    }
}

impl Drop for ShellBitmap {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(self.0.into());
        }
    }
}

async fn package_logo(app_id: &str) -> Option<Vec<u8>> {
    if !shell_identity(app_id) {
        return None;
    }
    let display = AppInfo::GetFromAppUserModelId(&HSTRING::from(app_id))
        .ok()?
        .DisplayInfo()
        .ok()?;
    let size = Size {
        Width: ICON_SIZE as f32,
        Height: ICON_SIZE as f32,
    };
    let (count, reader) = {
        let stream = display
            .GetLogo(size)
            .ok()?
            .OpenReadAsync()
            .ok()?
            .await
            .ok()?;
        let count = u32::try_from(stream.Size().ok()?).ok()?;
        if count == 0 || count > MAX_ICON_BYTES {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
        (count, reader)
    };
    if reader.LoadAsync(count).ok()?.await.ok()? != count {
        return None;
    }
    let mut bytes = vec![0; count as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(bytes)
}

fn decode_logo(bytes: &[u8]) -> Option<String> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP)
    ) {
        return None;
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(512);
    limits.max_image_height = Some(512);
    limits.max_alloc = Some(8 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().ok()?.to_rgba8();
    encode_png(&normalize_icon(image))
}

fn normalize_icon(image: RgbaImage) -> RgbaImage {
    if image.width().max(image.height()) <= ICON_SIZE {
        image
    } else {
        image::DynamicImage::ImageRgba8(image)
            .resize(ICON_SIZE, ICON_SIZE, FilterType::Lanczos3)
            .into_rgba8()
    }
}

fn encode_png(image: &RgbaImage) -> Option<String> {
    let mut output = Vec::new();
    PngEncoder::new(&mut output)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )
        .ok()?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(output)))
}

fn desktop_executable_name(app_id: &str) -> Option<&'static str> {
    // Distinguish known desktop identities and hashed browser profile identifiers.
    // The supplied AUMID never becomes a path to open.
    let id = app_id.to_ascii_lowercase();
    match id.as_str() {
        "spotify" | "spotify.exe" | "com.squirrel.spotify.spotify" => return Some("spotify.exe"),
        "chrome.exe" => return Some("chrome.exe"),
        "msedge.exe" => return Some("msedge.exe"),
        "firefox.exe" => return Some("firefox.exe"),
        _ => {}
    }
    let name = match id.split_once('.') {
        Some((name, profile))
            if (8..=32).contains(&profile.len())
                && profile.bytes().all(|c| c.is_ascii_hexdigit()) =>
        {
            name
        }
        Some(_) => return None,
        None => &id,
    };
    match name {
        "chrome" => Some("chrome.exe"),
        "msedge" => Some("msedge.exe"),
        "firefox" => Some("firefox.exe"),
        "brave" | "bravesoftware" => Some("brave.exe"),
        "vivaldi" => Some("vivaldi.exe"),
        "opera" => Some("opera.exe"),
        _ => None,
    }
}

fn local_executable(path: &Path) -> bool {
    path.is_absolute()
        && matches!(
            path.components().next(),
            Some(Component::Prefix(prefix))
                if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        )
        && path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
}

fn unique_running_executable(app_id: &str) -> Option<PathBuf> {
    let source_path = Path::new(app_id);
    let full_path = local_executable(source_path).then_some(source_path);
    let name = if let Some(path) = full_path {
        path.file_name()?.to_str()?
    } else if shell_identity(app_id) && app_id.to_ascii_lowercase().ends_with(".exe") {
        app_id
    } else {
        desktop_executable_name(app_id)?
    };

    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
    );
    let mut paths = system.processes().values().filter_map(|process| {
        if !process.name().eq_ignore_ascii_case(name) {
            return None;
        }
        let path = process.exe()?;
        let leaf = path.file_name()?;
        (leaf.eq_ignore_ascii_case(name)
            && local_executable(path)
            && full_path
                .is_none_or(|expected| path.as_os_str().eq_ignore_ascii_case(expected.as_os_str())))
        .then_some(path)
    });
    let path = paths.next()?;
    // Browser helper processes usually repeat the same executable. Separate
    // installations with the same name are ambiguous.
    if paths.any(|other| !path.as_os_str().eq_ignore_ascii_case(other.as_os_str())) {
        return None;
    }
    Some(path.to_owned())
}

struct AppIcon(HICON);

impl Drop for AppIcon {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyIcon(self.0);
        }
    }
}

struct IconCanvas {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    bits: *mut u8,
}

fn bitmap_info(width: u32, height: u32) -> BITMAPINFO {
    BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    }
}

impl IconCanvas {
    fn new() -> Option<Self> {
        let info = bitmap_info(ICON_SIZE, ICON_SIZE);
        // The DIB points to a fixed-size top-down BGRA buffer for the bitmap lifetime.
        unsafe {
            let dc = CreateCompatibleDC(None);
            if dc.is_invalid() {
                return None;
            }
            let mut bits = null_mut();
            let Ok(bitmap) = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
            else {
                let _ = DeleteDC(dc);
                return None;
            };
            let previous = SelectObject(dc, bitmap.into());
            if bits.is_null() || previous.is_invalid() {
                let _ = DeleteDC(dc);
                let _ = DeleteObject(bitmap.into());
                return None;
            }
            Some(Self {
                dc,
                bitmap,
                previous,
                bits: bits.cast(),
            })
        }
    }

    fn draw(&mut self, icon: &AppIcon, background: u8) -> Option<Vec<u8>> {
        let len = (ICON_SIZE * ICON_SIZE * 4) as usize;
        // Flush before accessing the DIB from Rust after GDI writes it.
        unsafe {
            slice::from_raw_parts_mut(self.bits, len).fill(background);
            DrawIconEx(
                self.dc,
                0,
                0,
                icon.0,
                ICON_SIZE as i32,
                ICON_SIZE as i32,
                0,
                None,
                DI_NORMAL,
            )
            .ok()?;
            if !GdiFlush().as_bool() {
                return None;
            }
            Some(slice::from_raw_parts(self.bits, len).to_vec())
        }
    }
}

impl Drop for IconCanvas {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.previous);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

fn extract_executable_icon(path: &Path) -> Option<RgbaImage> {
    let mut handle = HICON::default();
    let result = unsafe {
        SHDefExtractIconW(
            &HSTRING::from(path.as_os_str()),
            0,
            0,
            Some(&mut handle),
            None,
            ICON_SIZE,
        )
    };
    if handle.is_invalid() {
        return None;
    }
    let icon = AppIcon(handle);
    result.ok().ok()?;
    let mut canvas = IconCanvas::new()?;
    let black = canvas.draw(&icon, 0)?;
    let white = canvas.draw(&icon, 255)?;
    let mut rgba = Vec::with_capacity(black.len());
    for (black, white) in black.chunks_exact(4).zip(white.chunks_exact(4)) {
        rgba.extend_from_slice(&recover_pixel(black, white));
    }
    RgbaImage::from_raw(ICON_SIZE, ICON_SIZE, rgba)
}

// Compositing over both backgrounds reconstructs alpha for GDI's masked icons
// as well as alpha-blended icons, without relying on reserved DIB alpha bytes.
fn recover_pixel(black: &[u8], white: &[u8]) -> [u8; 4] {
    let difference: u16 = (0..3)
        .map(|i| u16::from(white[i].saturating_sub(black[i])))
        .sum();
    let alpha = 255 - difference.div_ceil(3);
    if alpha == 0 {
        return [0; 4];
    }
    let unpremultiply =
        |channel: u8| ((u16::from(channel) * 255 + alpha / 2) / alpha).min(255) as u8;
    [
        unpremultiply(black[2]),
        unpremultiply(black[1]),
        unpremultiply(black[0]),
        alpha as u8,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_only_desktop_source_ids_and_numeric_browser_profiles() {
        assert_eq!(desktop_executable_name("Chrome"), Some("chrome.exe"));
        assert_eq!(
            desktop_executable_name("MSEdge.1A2B3C4D"),
            Some("msedge.exe")
        );
        assert_eq!(desktop_executable_name("Spotify.exe"), Some("spotify.exe"));
        assert_eq!(desktop_executable_name("Chrome.fake"), None);
        assert_eq!(desktop_executable_name("Chrome.1A2B3C4D/calc.exe"), None);
    }

    #[test]
    fn keeps_shell_identities_separate_from_local_executables() {
        assert!(shell_identity(
            "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"
        ));
        assert!(shell_identity("MSEdge.1A2B3C4D"));
        assert!(!shell_identity(r"..\Spotify.exe"));
        assert!(!shell_identity("shell:AppsFolder"));
        assert!(local_executable(Path::new(r"C:\Local\Player.exe")));
        assert!(!local_executable(Path::new(r"\\remote\share\player.exe")));
        assert!(!local_executable(Path::new(r"C:\Local\Player.png")));
    }

    #[test]
    #[ignore = "requires Spotify's Windows Store app to be installed"]
    fn installed_spotify_shell_icon_contains_the_full_mark() {
        let image = shell_app_icon("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify")
            .expect("registered Spotify Shell icon");
        let (width, height) = image.dimensions();
        assert!(width >= 64 && height >= 64);
        assert_eq!(image.get_pixel(0, 0).0[3], 0, "transparent disk corner");
        let green = image
            .pixels()
            .filter(|pixel| {
                let [red, green, blue, alpha] = pixel.0;
                alpha > 250
                    && green > 150
                    && green > red.saturating_add(80)
                    && green > blue.saturating_add(50)
            })
            .count();
        let dark = image
            .pixels()
            .filter(|pixel| {
                let [red, green, blue, alpha] = pixel.0;
                alpha > 250 && red < 70 && green < 70 && blue < 70
            })
            .count();
        let area = (width * height) as usize;
        assert!(green > area / 4, "full green Spotify disk");
        assert!(dark > area / 25, "opaque dark waves across the logo");
    }

    #[test]
    fn reconstructs_transparent_and_colored_icon_pixels() {
        assert_eq!(
            recover_pixel(&[0, 0, 0, 0], &[255, 255, 255, 0]),
            [0, 0, 0, 0]
        );
        assert_eq!(
            recover_pixel(&[20, 40, 60, 0], &[20, 40, 60, 0]),
            [60, 40, 20, 255]
        );
        let pixel = recover_pixel(&[0, 0, 128, 0], &[127, 127, 255, 0]);
        assert_eq!(pixel, [255, 0, 0, 128]);
    }
}
