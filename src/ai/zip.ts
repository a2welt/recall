function crc32(data: Buffer): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function u16(value: number): Buffer { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value); return buffer; }
function u32(value: number): Buffer { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0); return buffer; }

export function createZip(files: Record<string, string>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name); const data = Buffer.from(content); const crc = crc32(data);
    const header = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes]);
    local.push(header, data);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]));
    offset += header.length + data.length;
  }
  const centralData = Buffer.concat(central); const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(centralData.length), u32(offset), u16(0)]);
  return Buffer.concat([...local, centralData, end]);
}
