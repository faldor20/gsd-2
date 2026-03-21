{
  lib,
  stdenv,
  importNpmLock,
  nodejs,
  bun,
  cliPackage,
}:

let
  # The web app keeps its own lockfile under gsd-web/, so we build it from a
  # source tree that still contains the shared packages/ workspace.
  npmMeta = import ./gsd-web-npm-meta.nix { inherit lib; };

  src = lib.cleanSourceWith {
    src = ../.;
    filter = path: type:
      let
        base = builtins.baseNameOf path;
      in
      lib.cleanSourceFilter path type && !(builtins.elem base [ "node_modules" "result" ]);
  };

  npmDeps = importNpmLock.buildNodeModules {
    package = npmMeta.pkg;
    packageLock = npmMeta.lock;
    npmRoot = src + "/gsd-web";
    nodejs = nodejs;
    derivationArgs.npmFlags = "--ignore-scripts";
  };
in
stdenv.mkDerivation {
  pname = "gsd-web";
  version = npmMeta.version;
  inherit src npmDeps;

  nativeBuildInputs = [ nodejs ];
  buildInputs = [ bun ];

  npmFlags = "--ignore-scripts";

  preBuild = ''
    # The browser workspace resolves dependencies from its own directory, so
    # we enter that directory and copy in the lock-derived node_modules tree to
    # keep it writable during the Vite build.
    cd gsd-web
    rm -rf node_modules
    cp -R ${npmDeps}/node_modules node_modules
    chmod -R u+w node_modules

    # Repoint the shared protocol dependency at the built CLI output so the
    # package exports resolve to the compiled dist files that gsd-web imports.
    rm -rf node_modules/@gsd/web-protocol
    ln -sf ${cliPackage}/lib/node_modules/gsd-pi/packages/gsd-web-protocol node_modules/@gsd/web-protocol
  '';

  buildPhase = ''
    runHook preBuild

    npm run build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/gsd-web
    cp -r . $out/share/gsd-web

    mkdir -p $out/bin
    cat > $out/bin/gsd-web <<EOF
#!/bin/sh
cd "$out/share/gsd-web"
  exec ${lib.getExe bun} run start "$@"
EOF
    chmod +x $out/bin/gsd-web

    runHook postInstall
  '';

  meta = with lib; {
    description = "GSD web frontend and preview server";
    homepage = "https://github.com/gsd-build/gsd-2";
    license = licenses.mit;
    sourceProvenance = with sourceTypes; [ fromSource ];
    maintainers = [ ];
    mainProgram = "gsd-web";
    platforms = platforms.all;
  };
}