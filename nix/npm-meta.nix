# Shared npm metadata for both the package build and the devShell.
#
# Strips @gsd-build/engine-* optional packages from both package.json
# and package-lock.json before they reach importNpmLock.  Those packages
# are pre-built Rust/N-API tarballs published to npm for non-Nix users;
# inside Nix the engine is compiled by rustPlatform.buildRustPackage so
# importNpmLock must not try to fetch them from the registry.
{ lib }:
let
  rawPkg  = lib.importJSON ../package.json;
  rawLock = lib.importJSON ../package-lock.json;

  # Predicate: is this a Nix-unused engine distribution tarball?
  isEnginePkg = name: lib.hasPrefix "@gsd-build/engine-" name;

  # package.json: drop engine-* from optionalDependencies so npm install
  # in offline mode does not try to resolve them from the registry.
  pkg = rawPkg // {
    optionalDependencies =
      lib.filterAttrs (n: _: !isEnginePkg n) rawPkg.optionalDependencies;
  };

  # package-lock.json:
  # 1. Remove node_modules/@gsd-build/engine-* entries so importNpmLock
  #    does not attempt to fetch those tarballs.
  # 2. Update the root "" entry's optionalDependencies to match; the
  #    mapLockDependencies pass in importNpmLock only looks up "latest"/
  #    GitHub refs so the version strings would pass through unchanged, but
  #    keeping the data consistent avoids future confusion.
  lockPackages =
    lib.mapAttrs
      (path: module:
        if path == "" && module ? optionalDependencies
        then
          module
          // {
            optionalDependencies =
              lib.filterAttrs (n: _: !isEnginePkg n) module.optionalDependencies;
          }
        else module)
      (lib.filterAttrs
        (path: _: !isEnginePkg (lib.removePrefix "node_modules/" path))
        rawLock.packages);

  lock = rawLock // { packages = lockPackages; };
in
{
  inherit pkg lock;
  # Version string derived from package.json; avoids stale hardcoded values.
  version = rawPkg.version;
}
