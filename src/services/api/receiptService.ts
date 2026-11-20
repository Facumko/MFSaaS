import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Linking from 'expo-linking';

export interface ReceiptLine { name: string; quantity: number; unitPrice: number }
export interface ReceiptData {
  code: string; date: string; customer: string; items: ReceiptLine[];
  paymentMethod: string; total: number; responsible: string;
}
export type ReceiptChannel = 'email' | 'whatsapp';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const money = (value: number) => `$${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const receiptService = {
  async generateAndShare(data: ReceiptData, channel: ReceiptChannel, recipient: string): Promise<void> {
    const rows = data.items.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${money(item.unitPrice)}</td><td>${money(item.quantity * item.unitPrice)}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:#222;padding:28px}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}th{background:#f3f3f3}.total{text-align:right;font-size:20px;font-weight:bold;margin-top:20px}.meta{line-height:1.7}</style></head><body><h1>Comprobante de venta</h1><div class="meta"><b>Pedido:</b> ${escapeHtml(data.code)}<br><b>Fecha:</b> ${escapeHtml(data.date)}<br><b>Cliente:</b> ${escapeHtml(data.customer)}<br><b>Responsable:</b> ${escapeHtml(data.responsible)}<br><b>Forma de pago:</b> ${escapeHtml(data.paymentMethod)}</div><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th>Subtotal</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total: ${money(data.total)}</div></body></html>`;
    if (Platform.OS === 'web') {
      await Print.printAsync({ html });
      const subject = encodeURIComponent(`Comprobante ${data.code}`);
      const body = encodeURIComponent(`Hola, te comparto el comprobante PDF del pedido ${data.code}. Adjuntá el archivo que acabás de guardar.`);
      const digits = recipient.replace(/\D/g, '');
      const whatsappNumber = digits.startsWith('54') ? digits : `549${digits.replace(/^0+/, '')}`;
      const target = channel === 'email'
        ? `mailto:${encodeURIComponent(recipient)}?subject=${subject}&body=${body}`
        : `https://wa.me/${whatsappNumber}?text=${body}`;
      await Linking.openURL(target);
      return;
    }
    const file = await Print.printToFileAsync({ html, base64: false });
    if (!(await Sharing.isAvailableAsync())) throw new Error('El dispositivo no permite compartir el comprobante PDF.');
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Enviar comprobante ${data.code} a ${recipient} por ${channel === 'email' ? 'correo' : 'WhatsApp'}` });
  },
};
