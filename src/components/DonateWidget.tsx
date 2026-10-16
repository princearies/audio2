import { useState } from 'react';

const DONATE_URL = 'https://awangbotv3.mykira.workers.dev/pay?donate=1';
const QR_SRC = 'https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=' + encodeURIComponent(DONATE_URL);

export default function DonateWidget() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      {open && (
        <div style={{ marginBottom: 8, width: 176, borderRadius: 16, background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.1)', padding: 12, textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
          <p style={{ fontSize: 11, fontWeight: 'bold', color: '#fff', marginBottom: 4 }}>Suka tool ni? ☕</p>
          <a href={DONATE_URL} target="_blank" rel="noreferrer">
            <img src={QR_SRC} width={140} height={140} alt="Derma" style={{ margin: '0 auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }} loading="lazy" />
          </a>
          <a href={DONATE_URL} target="_blank" rel="noreferrer" style={{ marginTop: 6, display: 'inline-block', fontSize: 11, color: '#fcd34d', textDecoration: 'underline' }}>
            Belanja kopi
          </a>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Derma"
        style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#06b6d4)', fontSize: 20, border: 'none', cursor: 'pointer', boxShadow: '0 4px 14px rgba(59,130,246,0.4)' }}
      >
        ☕
      </button>
    </div>
  );
}
