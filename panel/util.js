export function sameUrl(left, right) {
  if (!left || !right) return false;
  try {
    const a = new URL(left);
    const b = new URL(right);
    a.hash = "";
    b.hash = "";
    return a.toString() === b.toString();
  } catch {
    return left === right;
  }
}
