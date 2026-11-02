/** Preserve numeric measurements; escape untrusted spreadsheet text separately. */
export function csvCell(value: unknown): string {
 if(typeof value==='number')return Number.isFinite(value)?String(value):'';
 const s=String(value??'');
 const guard=/^(?:\s*[=+\-@]|[\t\r\n])/.test(s)?"'":'';
 return '"'+guard+s.replaceAll('"','""')+'"';
}
