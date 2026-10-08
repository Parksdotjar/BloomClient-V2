fn main() {
    use sha2::{Digest, Sha256};

    println!("cargo:rerun-if-env-changed=BLOOM_BACKEND_URL");
    println!("cargo:rerun-if-env-changed=BLOOM_COSMETICS_ENABLED");
    println!("cargo:rerun-if-changed=resources/bloom-cosmetics-1.21.11.jar");
    println!("cargo:rerun-if-changed=resources/bloom-cosmetics-1.21.11.sha256");
    let enabled = std::env::var("BLOOM_COSMETICS_ENABLED").as_deref() != Ok("false");
    let release = std::env::var("PROFILE").as_deref() == Ok("release");
    let jar = std::path::Path::new("resources/bloom-cosmetics-1.21.11.jar");
    let code = if jar.exists() {
        let path = jar.canonicalize().unwrap();
        let hash = std::fs::read_to_string("resources/bloom-cosmetics-1.21.11.sha256")
            .expect("Run npm run build:cosmetics to generate the checksum");
        let expected = hash.trim();
        let actual = format!(
            "{:x}",
            Sha256::digest(
                std::fs::read(&path).expect("Could not read the bundled Bloom Cosmetics renderer")
            )
        );
        assert_eq!(actual, expected, "The bundled Bloom Cosmetics renderer does not match its checksum; run npm run build:cosmetics");
        format!(
            "const BUNDLED_JAR: &[u8] = include_bytes!({:?}); const BUNDLED_SHA: &str = {:?};",
            path,
            hash.trim()
        )
    } else {
        assert!(!(enabled && release), "A production Bloom build cannot omit the cape renderer. Run npm run build:cosmetics or explicitly set BLOOM_COSMETICS_ENABLED=false for an emergency build.");
        println!("cargo:warning=Bloom Cosmetics renderer is absent from this debug build; use npm run tauri:dev so Bloom prepares it automatically");
        "const BUNDLED_JAR: &[u8] = &[]; const BUNDLED_SHA: &str = \"\";".into()
    };
    std::fs::write(
        std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("cosmetics_bundle.rs"),
        code,
    )
    .unwrap();
    tauri_build::build()
}
