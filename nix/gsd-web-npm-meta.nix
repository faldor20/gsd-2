# Shared npm metadata for the gsd-web package build.
#
# The web app has its own package-lock.json inside gsd-web/, so we keep the
# metadata separate from the root CLI package to avoid cross-contaminating the
# two dependency graphs.
{ lib }:
let
  rawPkg  = lib.importJSON ../gsd-web/package.json;
  rawLock = lib.importJSON ../gsd-web/package-lock.json;
in
{
  pkg = rawPkg;
  lock = rawLock;
  version = rawPkg.version;
}