{
  description = "GSD — Get Shit Done coding agent CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    systems.url = "github:nix-systems/default";
    llm-agents = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      systems,
      llm-agents,
    }:
    let
      forAllSystems = nixpkgs.lib.genAttrs (import systems);
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs     = nixpkgs.legacyPackages.${system};
          mcporter = llm-agents.packages.${system}.mcporter;
          cliPackage = pkgs.callPackage ./package.nix {
            inherit mcporter;
            nodejs = pkgs.nodejs_24;
          };
        in
        {
          default = cliPackage;
          gsd-cli = cliPackage;
          gsd-web = pkgs.callPackage ./nix/gsd-web.nix {
            nodejs = pkgs.nodejs_24;
            bun = pkgs.bun;
            inherit cliPackage;
          };
        }
      );

      apps = forAllSystems (
        system:
        {
          gsd-web = {
            type = "app";
            program = "${self.packages.${system}.gsd-web}/bin/gsd-web";
          };
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs     = nixpkgs.legacyPackages.${system};
          mcporter = llm-agents.packages.${system}.mcporter;

          # Filtered package metadata (engine tarballs excluded).
          npmMeta  = pkgs.callPackage ./nix/npm-meta.nix { };

          # Pre-built node_modules derived from package-lock.json integrity
          # hashes.  Nix caches this derivation; no `npm install` needed in
          # the shell.  npmFlags suppresses install/rebuild scripts so no
          # native compilation runs here (the engine is built separately).
          nodeModules = pkgs.importNpmLock.buildNodeModules {
            package     = npmMeta.pkg;
            packageLock = npmMeta.lock;
            npmRoot     = ./.;
            nodejs      = pkgs.nodejs_24;
            derivationArgs.npmFlags = "--ignore-scripts";
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.cargo
              pkgs.rustc
              pkgs.pkg-config
              pkgs.zlib
              mcporter
              # Provides the linkNodeModulesHook bash function used below.
              pkgs.importNpmLock.hooks.linkNodeModulesHook
            ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
              pkgs.stdenv.cc.cc.lib
            ];

            # linkNodeModulesHook reads $npmDeps to find the pre-built
            # node_modules derivation and symlinks it into the project dir.
            npmDeps = nodeModules;

            shellHook = ''
              linkNodeModulesHook
              echo "GSD development shell"
              echo "node_modules linked from Nix store (run 'npm run build' to compile)"
            '';
          };
        }
      );
    };
}
