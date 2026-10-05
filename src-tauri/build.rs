fn main() {
    println!("cargo:rerun-if-env-changed=BLOOM_BACKEND_URL");
    println!("cargo:rerun-if-env-changed=BLOOM_COSMETICS_ENABLED");
    println!("cargo:rerun-if-changed=resources/bloom-cosmetics-1.21.11.jar");
    println!("cargo:rerun-if-changed=resources/bloom-cosmetics-1.21.11.sha256");
    let jar = std::path::Path::new("resources/bloom-cosmetics-1.21.11.jar");
    let code = if jar.exists() {
        let path = jar.canonicalize().unwrap();
        let hash = std::fs::read_to_string("resources/bloom-cosmetics-1.21.11.sha256").expect("Run npm run build:cosmetics to generate the checksum");
        format!("const BUNDLED_JAR: &[u8] = include_bytes!({:?}); const BUNDLED_SHA: &str = {:?};", path, hash.trim())
    } else { "const BUNDLED_JAR: &[u8] = &[]; const BUNDLED_SHA: &str = \"\";".into() };
    std::fs::write(std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("cosmetics_bundle.rs"), code).unwrap();
    tauri_build::build()
}
