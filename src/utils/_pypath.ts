/** `posixpath` helpers with CPython semantics (shared seam, not a Python module mirror). */

/** `posixpath.normpath`. */
export function posixNormpath(path: string): string {
  if (path === "") return ".";
  let initialSlashes = path.startsWith("/") ? 1 : 0;
  // POSIX: exactly two leading slashes are preserved, three or more collapse to one.
  if (initialSlashes && path.startsWith("//") && !path.startsWith("///")) initialSlashes = 2;
  const comps = path.split("/");
  const out: string[] = [];
  for (const comp of comps) {
    if (comp === "" || comp === ".") continue;
    if (comp !== ".." || (!initialSlashes && out.length === 0) || (out.length > 0 && out[out.length - 1] === "..")) {
      out.push(comp);
    } else if (out.length) {
      out.pop();
    }
  }
  const joined = out.join("/");
  return (initialSlashes ? "/".repeat(initialSlashes) : "") + joined || ".";
}

/** `posixpath.basename`. */
export function posixBasename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** `posixpath.dirname`. */
export function posixDirname(p: string): string {
  const i = p.lastIndexOf("/") + 1;
  let head = p.slice(0, i);
  if (head && head !== "/".repeat(head.length)) head = head.replace(/\/+$/, "");
  return head;
}
