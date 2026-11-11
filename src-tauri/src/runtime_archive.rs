use std::{
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

fn safe_relative(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

fn safe_link(entry: &Path, target: &Path, symbolic: bool) -> bool {
    if target.is_absolute() {
        return false;
    }
    let mut parts = if symbolic {
        entry
            .parent()
            .unwrap_or(Path::new(""))
            .components()
            .filter(|c| matches!(c, Component::Normal(_)))
            .count()
    } else {
        0
    };
    for component in target.components() {
        match component {
            Component::Normal(_) => parts += 1,
            Component::CurDir => (),
            Component::ParentDir if parts > 0 => parts -= 1,
            _ => return false,
        }
    }
    parts > 0
}

fn no_link_ancestors(root: &Path, relative: &Path) -> Result<(), String> {
    let mut path = root.to_path_buf();
    for component in relative.components() {
        path.push(component);
        if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("The Java archive attempted to write through a symbolic link.".into());
        }
    }
    Ok(())
}

pub fn extract(
    archive: &Path,
    staging: &Path,
    extension: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    if extension == "zip" {
        return extract_zip(archive, staging, cancel);
    }
    if extension != "tar.gz" {
        return Err("Unsupported Java archive format.".into());
    }
    let reader =
        flate2::read::GzDecoder::new(std::fs::File::open(archive).map_err(|e| e.to_string())?);
    let mut tar = tar::Archive::new(reader);
    // Executable bits are retained; setuid/setgid and ownership are not restored.
    tar.set_preserve_permissions(false);
    tar.set_overwrite(false);
    for entry in tar.entries().map_err(|e| e.to_string())? {
        if cancel.load(Ordering::SeqCst) {
            return Err("__cancelled__".into());
        }
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        if !safe_relative(&path) {
            return Err("The Java archive contained an unsafe path.".into());
        }
        no_link_ancestors(staging, &path)?;
        let kind = entry.header().entry_type();
        if kind.is_symlink() || kind.is_hard_link() {
            let target = entry
                .link_name()
                .map_err(|e| e.to_string())?
                .ok_or("Java archive link has no target.")?;
            if !safe_link(&path, &target, kind.is_symlink()) {
                return Err("The Java archive contained an unsafe link.".into());
            }
        } else if !kind.is_file() && !kind.is_dir() {
            return Err("Unsupported entry in the Java archive.".into());
        }
        if !entry
            .unpack_in(staging)
            .map_err(|e| format!("Java extraction failed: {e}"))?
        {
            return Err("The Java archive attempted to escape its installation directory.".into());
        }
    }
    Ok(())
}

fn extract_zip(archive: &Path, staging: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip =
        zip::ZipArchive::new(file).map_err(|e| format!("Java archive could not be opened: {e}"))?;
    for index in 0..zip.len() {
        if cancel.load(Ordering::SeqCst) {
            return Err("__cancelled__".into());
        }
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or("The Java archive contained an unsafe path.")?;
        let target = staging.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut file = std::fs::File::create(target).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn find_java(folder: &Path, executable: &str) -> Option<PathBuf> {
    let mut pending = vec![folder.to_path_buf()];
    while let Some(current) = pending.pop() {
        for entry in std::fs::read_dir(current).ok()?.flatten() {
            let path = entry.path();
            let kind = entry.file_type().ok()?;
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file()
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.eq_ignore_ascii_case(executable))
            {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_archive_rejects_escaping_paths_and_links() {
        for path in ["../escape", "/absolute", "jdk/../../escape"] {
            assert!(!safe_relative(Path::new(path)));
        }
        assert!(safe_link(
            Path::new("jdk/Contents/Home/lib/libjvm.dylib"),
            Path::new("server/libjvm.dylib"),
            true
        ));
        assert!(!safe_link(
            Path::new("jdk/link"),
            Path::new("../../escape"),
            true
        ));
        assert!(!safe_link(
            Path::new("jdk/link"),
            Path::new("../escape"),
            false
        ));
    }
    #[test]
    fn runtime_archive_windows_zip_still_finds_javaw_and_rejects_traversal() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("bloom-zip-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let archive = root.join("java.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        zip.start_file(
            "jdk/bin/javaw.exe",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(b"windows-java").unwrap();
        zip.finish().unwrap();
        extract(
            &archive,
            &root.join("install"),
            "zip",
            &AtomicBool::new(false),
        )
        .unwrap();
        let java = find_java(&root.join("install"), "javaw.exe").unwrap();
        assert_eq!(std::fs::read(java).unwrap(), b"windows-java");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        zip.start_file("../escape", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"escape").unwrap();
        zip.finish().unwrap();
        assert!(extract(
            &archive,
            &root.join("install"),
            "zip",
            &AtomicBool::new(false)
        )
        .is_err());
        assert!(!root.join("escape").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn runtime_archive_refuses_escaping_tar_links_before_creating_them() {
        let root = std::env::temp_dir().join(format!("bloom-tar-links-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("install")).unwrap();
        for kind in [tar::EntryType::Symlink, tar::EntryType::Link] {
            let archive = root.join("java.tar.gz");
            let encoder = flate2::write::GzEncoder::new(
                std::fs::File::create(&archive).unwrap(),
                flate2::Compression::default(),
            );
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_size(0);
            header.set_mode(0o755);
            header.set_entry_type(kind);
            builder
                .append_link(&mut header, "jdk/link", "../../escape")
                .unwrap();
            builder.into_inner().unwrap().finish().unwrap();
            assert!(extract(
                &archive,
                &root.join("install"),
                "tar.gz",
                &AtomicBool::new(false)
            )
            .unwrap_err()
            .contains("unsafe link"));
            assert!(std::fs::symlink_metadata(root.join("install/jdk/link")).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn runtime_archive_preserves_internal_symlinks_but_never_writes_through_them() {
        let root = std::env::temp_dir().join(format!("bloom-tar-symlink-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("install/jdk/lib")).unwrap();
        let archive = root.join("java.tar.gz");
        let encoder = flate2::write::GzEncoder::new(
            std::fs::File::create(&archive).unwrap(),
            flate2::Compression::default(),
        );
        let mut builder = tar::Builder::new(encoder);
        let mut link = tar::Header::new_gnu();
        link.set_size(0);
        link.set_mode(0o755);
        link.set_entry_type(tar::EntryType::Symlink);
        builder.append_link(&mut link, "jdk/link", "lib").unwrap();
        let mut file = tar::Header::new_gnu();
        file.set_size(4);
        file.set_mode(0o644);
        file.set_cksum();
        builder
            .append_data(&mut file, "jdk/link/overwrite", &b"data"[..])
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();
        assert!(extract(
            &archive,
            &root.join("install"),
            "tar.gz",
            &AtomicBool::new(false)
        )
        .unwrap_err()
        .contains("symbolic link"));
        assert_eq!(
            std::fs::read_link(root.join("install/jdk/link")).unwrap(),
            Path::new("lib")
        );
        assert!(!root.join("install/jdk/lib/overwrite").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn runtime_archive_installs_mac_bundle_layout_and_honors_cancel() {
        let root =
            std::env::temp_dir().join(format!("bloom-runtime-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("install")).unwrap();
        let archive = root.join("java.tar.gz");
        let encoder = flate2::write::GzEncoder::new(
            std::fs::File::create(&archive).unwrap(),
            flate2::Compression::default(),
        );
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(4);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(&mut header, "jdk/Contents/Home/bin/java", &b"java"[..])
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();
        extract(
            &archive,
            &root.join("install"),
            "tar.gz",
            &AtomicBool::new(false),
        )
        .unwrap();
        let java = find_java(&root.join("install"), "java").unwrap();
        assert_eq!(std::fs::read(&java).unwrap(), b"java");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(
                std::fs::metadata(java).unwrap().permissions().mode() & 0o111,
                0
            );
        }
        assert_eq!(
            extract(
                &archive,
                &root.join("cancelled"),
                "tar.gz",
                &AtomicBool::new(true)
            )
            .unwrap_err(),
            "__cancelled__"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
