#[cfg(target_os = "windows")]
pub fn log_redirection_guard_status() {
    use windows_sys::Win32::System::SystemServices::PROCESS_MITIGATION_REDIRECTION_TRUST_POLICY;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessMitigationPolicy, ProcessRedirectionTrustPolicy};

    let mut policy: PROCESS_MITIGATION_REDIRECTION_TRUST_POLICY = unsafe { std::mem::zeroed() };

    let result = unsafe {
        GetProcessMitigationPolicy(
            GetCurrentProcess(),
            ProcessRedirectionTrustPolicy,
            &mut policy as *mut _ as *mut std::ffi::c_void,
            std::mem::size_of::<PROCESS_MITIGATION_REDIRECTION_TRUST_POLICY>(),
        )
    };

    if result != 0 {
        let flags = unsafe { policy.Anonymous.Flags };
        let enforce = flags & 1;
        let audit = (flags >> 1) & 1;
        if enforce != 0 || audit != 0 {
            eprintln!(
                "[vibe99] RedirectionGuard ACTIVE (enforce={}, audit={}, flags=0x{:08x})",
                enforce, audit, flags
            );
        } else {
            eprintln!(
                "[vibe99] RedirectionGuard: policy set but not enforced (flags=0x{:08x})",
                flags
            );
        }
    } else {
        eprintln!("[vibe99] RedirectionGuard: not set for this process");
    }

    // Try resolving cargo.exe symlink as a sanity check
    if let Ok(home) = std::env::var("USERPROFILE") {
        let cargo = std::path::Path::new(&home)
            .join(".cargo")
            .join("bin")
            .join("cargo.exe");
        if cargo.exists() {
            match std::fs::read_link(&cargo) {
                Ok(target) => eprintln!(
                    "[vibe99] cargo.exe symlink -> {:?} (resolvable)",
                    target
                ),
                Err(e) => eprintln!(
                    "[vibe99] cargo.exe read_link failed: {} (os error {})",
                    e,
                    e.raw_os_error().unwrap_or(0)
                ),
            }
            match std::fs::canonicalize(&cargo) {
                Ok(resolved) => {
                    eprintln!("[vibe99] cargo.exe canonicalize -> {:?}", resolved);
                }
                Err(e) => {
                    eprintln!(
                        "[vibe99] cargo.exe canonicalize FAILED: {} (os error {})",
                        e,
                        e.raw_os_error().unwrap_or(0)
                    );
                }
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn log_redirection_guard_status() {}
