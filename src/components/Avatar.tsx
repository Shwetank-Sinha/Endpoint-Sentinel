import { useState } from 'react';
export default function Avatar({ name, url }: { name: string; url: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className="es-avatar" aria-hidden="true">{url && failedUrl !== url ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} /> : name.slice(0, 1).toUpperCase()}</span>;
}
