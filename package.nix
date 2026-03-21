{
  lib,
  stdenv,
  importNpmLock,
  nodejs,
  rustPlatform,
  pkg-config,
  zlib,
  makeWrapper,
  mcporter,
}:

let
  # Read package metadata once; version is derived from package.json so it
  # never drifts from the published manifest.
  npmMeta = import ./nix/npm-meta.nix { inherit lib; };
  pname   = "gsd-cli";
  version = npmMeta.version;

  # ─────────────────────────────────────────────────────────────────────────
  # Phase 1: Build the Rust N-API native addon (gsd-engine.node)
  #
  # The native crate is a cdylib that exposes high-performance utilities
  # (grep, AST parsing, image ops, etc.) to Node.js via N-API.  We build it
  # with rustPlatform so Nix can hash-pin the Cargo dependencies.
  # ─────────────────────────────────────────────────────────────────────────
  gsd-engine = rustPlatform.buildRustPackage {
    pname = "gsd-engine";
    inherit version;

    # Point src directly at the native/ subdirectory so Cargo.lock is at the
    # root of the source tree — rustPlatform.buildRustPackage requires it.
    src = lib.cleanSource ./native;

    cargoLock = {
      lockFile = ./native/Cargo.lock;
    };

    # Disable the default check phase; the crate has no standalone tests.
    doCheck = false;

    nativeBuildInputs = [ pkg-config ];
    buildInputs = [ zlib ] ++ lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

    # N-API cdylib produces a shared library; copy it to the addon directory
    # name that the JS loader expects at runtime (mirrors native/scripts/build.js).
    postInstall = ''
      mkdir -p $out/addon

      local platform_tag
      case "${stdenv.hostPlatform.system}" in
        x86_64-linux)   platform_tag="linux-x64"   ;;
        aarch64-linux)  platform_tag="linux-arm64"  ;;
        x86_64-darwin)  platform_tag="darwin-x64"   ;;
        aarch64-darwin) platform_tag="darwin-arm64"  ;;
        *)              platform_tag="${stdenv.hostPlatform.system}" ;;
      esac

      local lib_name
      if [ "${toString stdenv.hostPlatform.isDarwin}" = "1" ]; then
        lib_name="libgsd_engine.dylib"
      else
        lib_name="libgsd_engine.so"
      fi

      cp $out/lib/$lib_name $out/addon/gsd_engine.''${platform_tag}.node
    '';
  };

  # Build from a source tree with local outputs stripped out.  The devShell now
  # materializes node_modules in-place, so plain cleanSource would accidentally
  # capture that symlink and make npm install fail inside the Nix sandbox.
  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: type:
      let
        base = builtins.baseNameOf path;
      in
      lib.cleanSourceFilter path type && !(builtins.elem base [ "node_modules" "dist" "result" ]);
  };

  npmDeps = importNpmLock {
    npmRoot    = src;
    package    = npmMeta.pkg;
    packageLock = npmMeta.lock;
  };

in

# ─────────────────────────────────────────────────────────────────────────
# Phase 2: Build the Node.js / TypeScript packages
#
# importNpmLock.npmConfigHook populates node_modules offline from the
# lock-derived store paths, then preBuild overrides the workspace symlinks
# so tsc output lands in the writable build tree (not the read-only store).
# ─────────────────────────────────────────────────────────────────────────
stdenv.mkDerivation {
  inherit pname version src npmDeps;

  nativeBuildInputs = [
    nodejs
    importNpmLock.npmConfigHook
    makeWrapper
  ];

  buildInputs = [ zlib ] ++ lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  # Pass --ignore-scripts to both `npm install` and `npm rebuild` inside
  # npmConfigHook so no install scripts run (Playwright browser downloads,
  # sharp prebuilds, etc.) — we handle native compilation via rustPlatform.
  npmFlags = "--ignore-scripts";

  # ── preBuild ──────────────────────────────────────────────────────────
  # importNpmLock.npmConfigHook installs workspace packages as symlinks to
  # read-only store paths.  Override them with symlinks to the writable
  # build-dir copies so that compiled dist/ outputs (built below) are
  # visible to downstream packages inside the same build.
  preBuild = ''
    # Replace npm's workspace links with ones that target the writable build
    # tree.  ln -sf is not enough here because npm leaves directory symlinks
    # behind, and rewriting those in-place can silently follow the old target.
    rm -rf node_modules/@gsd
    mkdir -p node_modules/@gsd
    ln -sf "$PWD/packages/native" node_modules/@gsd/native
    ln -sf "$PWD/packages/gsd-web-protocol" node_modules/@gsd/web-protocol
    for pkg in pi-agent-core pi-ai pi-coding-agent pi-tui; do
      ln -sf "$PWD/packages/$pkg" "node_modules/@gsd/$pkg"
    done

    # Copy the pre-built native .node addon so @gsd/native can locate it
    # (the JS loader probes native/addon/*.node at runtime).
    mkdir -p native/addon
    cp ${gsd-engine}/addon/gsd_engine.*.node native/addon/

    # Build workspace packages that only contribute generated JS/types before
    # downstream packages consume them via workspace imports.
    npm run build:native-pkg
    npm run build:web-proto
  '';

  buildPhase = ''
    runHook preBuild

    # Build sub-packages in dependency order.
    npm run build:pi-tui
    npm run build:pi-ai
    npm run build:pi-agent-core
    npm run build:pi-coding-agent

    # Build main TypeScript sources.
    npx tsc

    # Copy static resources (themes, HTML export, extension resources).
    node scripts/copy-resources.cjs
    node scripts/copy-themes.cjs
    node scripts/copy-export-html.cjs

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/node_modules/gsd-pi
    cp -r . $out/lib/node_modules/gsd-pi

    # Re-create @gsd symlinks in the installed location so Node can resolve
    # them at runtime.  Remove the copied build-tree links first; otherwise
    # ln -sf may follow the stale directory symlink into /build instead of
    # replacing it.
    rm -rf $out/lib/node_modules/gsd-pi/node_modules/@gsd
    mkdir -p $out/lib/node_modules/gsd-pi/node_modules/@gsd
    ln -sf "$out/lib/node_modules/gsd-pi/packages/native" \
           "$out/lib/node_modules/gsd-pi/node_modules/@gsd/native"
    ln -sf "$out/lib/node_modules/gsd-pi/packages/gsd-web-protocol" \
           "$out/lib/node_modules/gsd-pi/node_modules/@gsd/web-protocol"
    for pkg in pi-agent-core pi-ai pi-coding-agent pi-tui; do
      ln -sf "$out/lib/node_modules/gsd-pi/packages/$pkg" \
             "$out/lib/node_modules/gsd-pi/node_modules/@gsd/$pkg"
    done

    # Wrap the Node.js binary; add mcporter to PATH so the agent can spawn it.
    mkdir -p $out/bin
    makeWrapper ${lib.getExe nodejs} $out/bin/gsd \
      --add-flags "$out/lib/node_modules/gsd-pi/dist/loader.js" \
      --prefix PATH : "${lib.makeBinPath [ mcporter ]}" \
      --prefix LD_LIBRARY_PATH : "${
        lib.makeLibraryPath ([ zlib ] ++ lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ])
      }" \
      --set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 1 \
      --set GSD_SKIP_VERSION_CHECK 1

    ln -s $out/bin/gsd $out/bin/gsd-cli

    runHook postInstall
  '';

  meta = with lib; {
    description = "Get Shit Done coding agent CLI";
    homepage    = "https://github.com/gsd-build/gsd-2";
    license     = licenses.mit;
    sourceProvenance = with sourceTypes; [ fromSource ];
    maintainers = [ ];
    mainProgram = "gsd";
    platforms   = platforms.all;
  };
}
