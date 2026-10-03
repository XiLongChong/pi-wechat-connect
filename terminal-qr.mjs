import QRCode from "qrcode";

// Each half block encodes two modules. Explicit colors and a four-module quiet
// zone preserve scanning under either terminal theme.
export function createTerminalQr(value) {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
  const margin = 4;
  const width = modules.size + margin * 2;
  const dark = (x, y) => x >= margin && y >= margin && x < width - margin && y < width - margin && modules.get(y - margin, x - margin);
  const rows = [];
  for (let y = 0; y < width; y += 2) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const top = dark(x, y) ? 0 : 255;
      const bottom = dark(x, y + 1) ? 0 : 255;
      row += `\x1b[38;2;${top};${top};${top}m\x1b[48;2;${bottom};${bottom};${bottom}m▀`;
    }
    rows.push(row + "\x1b[0m");
  }
  return { rows, width };
}
