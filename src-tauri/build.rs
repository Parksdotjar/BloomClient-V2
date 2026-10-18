fn main() {
    use sha2::{Digest, Sha256};

    println!("cargo:rerun-if-env-changed=BLOOM_BACKEND_URL");
    println!("cargo:rerun-if-env-changed=BLOOM_COSMETICS_ENABLED");
    let enabled = std::env::var("BLOOM_COSMETICS_ENABLED").as_deref() != Ok("false");
    let release = std::env::var("PROFILE").as_deref() == Ok("release");
    let mut code = String::from("const BUNDLES: &[(&str, &str, &[u8], &str)] = &[\n");
    for version in ["1.21.11", "26.1", "26.2", "26.3"] {
        let filename = format!("bloom-cosmetics-{version}.jar");
        let jar = std::path::PathBuf::from("resources").join(&filename);
        let checksum = jar.with_extension("sha256");
        println!("cargo:rerun-if-changed={}", jar.display());
        println!("cargo:rerun-if-changed={}", checksum.display());
        if jar.exists() {
            let hash = std::fs::read_to_string(checksum).expect("Run npm run build:cosmetics");
            let actual = format!("{:x}", Sha256::digest(std::fs::read(&jar).unwrap()));
            assert_eq!(
                actual,
                hash.trim(),
                "Cosmetics checksum mismatch for {version}"
            );
            code.push_str(&format!(
                "({version:?}, {filename:?}, include_bytes!({:?}), {:?}),\n",
                jar.canonicalize().unwrap(),
                hash.trim()
            ));
        } else {
            assert!(
                !(enabled && release),
                "Missing cosmetics renderer for {version}; run npm run build:cosmetics"
            );
            println!("cargo:warning=Missing cosmetics renderer for {version}; run npm run build:cosmetics");
        }
    }
    code.push_str("];\n");
    std::fs::write(
        std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("cosmetics_bundle.rs"),
        code,
    )
    .unwrap();
    tauri_build::build()
}
