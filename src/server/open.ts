/**
 * Cross-platform "open URL in default browser" — no extra deps.
 */
import { exec } from "node:child_process";

export function openUrl(url: string): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) console.warn(`Could not open browser: ${err.message}`);
  });
}
