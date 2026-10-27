import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const AttachmentsPanel = ({ objectApiName, recordId }) => {
  const qc = useQueryClient();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', objectApiName, recordId],
    queryFn: async () => {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:5002';
      const res = await fetch(`${base}/api/v1/files?objectApiName=${encodeURIComponent(objectApiName)}&recordId=${recordId}`, { credentials: 'include' });
      const json = await res.json();
      return json?.data?.items || json?.data || [];
    },
    enabled: !!objectApiName && !!recordId,
  });

  const upload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('objectApiName', objectApiName);
    fd.append('recordId', recordId);
    try {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:5002';
      const res = await fetch(`${base}/api/v1/files/upload`, { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Upload failed');
      setFile(null);
      qc.invalidateQueries({ queryKey: ['attachments', objectApiName, recordId] });
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const items = Array.isArray(data) ? data : [];

  return (
    <div style={{ marginTop: '1rem' }}>
      <h3>Attachments</h3>
      {isLoading && <p>Loading...</p>}
      {!isLoading && items.length === 0 && <p>No attachments.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((a) => (
          <li key={a._id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span>{a.name}</span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{a.mimeType} · {a.sizeBytes} bytes</span>
            <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:5002'}/api/v1/files/${a._id}/preview`} target="_blank" rel="noreferrer">Preview</a>
            <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:5002'}/api/v1/files/${a._id}/download`}>Download</a>
          </li>
        ))}
      </ul>
      <form onSubmit={upload} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button type="submit" disabled={uploading || !file}>{uploading ? 'Uploading...' : 'Upload'}</button>
      </form>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
    </div>
  );
};

export default AttachmentsPanel;
