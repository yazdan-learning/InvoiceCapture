import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadReceipt } from '../api';

export function UploadPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => {
    if (!file) return null;
    return previewUrl ?? URL.createObjectURL(file);
  }, [file, previewUrl]);

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setStatus('idle');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(selectedFile));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) handleFileSelect(selected);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) handleFileSelect(droppedFile);
  };

  const handleReset = () => {
    setFile(null);
    setPreviewUrl(null);
    setError(null);
    setStatus('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!file) {
      setError('Please select an invoice first.');
      return;
    }
    setStatus('uploading');
    setError(null);

    try {
      const response = await uploadReceipt({ file });
      if (response.data) {
        navigate(`/expenses/${response.data.id}`, { state: { justUploaded: true } });
      } else {
        throw new Error(response.message || 'Extraction failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
      setStatus('error');
    }
  };

  if (status === 'uploading') {
    return (
      <div className="processing-card">
        <div className="spinner-container">
          <div className="spinner"></div>
        </div>
        <h2>Processing Invoice</h2>
        <p className="processing-text">Extracting data from your document…</p>
        <div className="processing-steps">
          <div className="step active">
            <div className="step-icon">✓</div>
            <span>File uploaded</span>
          </div>
          <div className="step active">
            <div className="step-icon">
              <div className="step-spinner"></div>
            </div>
            <span>OCR scanning</span>
          </div>
          <div className="step">
            <div className="step-icon">3</div>
            <span>AI structuring</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="upload-card">
      <div
        className={`dropzone ${isDragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          onChange={handleFileChange}
          aria-label="Invoice file"
          capture="environment"
          style={{ display: 'none' }}
        />

        {!file ? (
          <div className="dropzone-content">
            <div className="upload-icon-container">
              <svg className="upload-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h3>Drop invoice here or click to browse</h3>
            <p className="dropzone-hint">Supports JPEG, PNG, PDF • Max 10MB</p>
          </div>
        ) : (
          <div className="preview-container">
            {file.type.startsWith('image/') ? (
              <img src={preview!} alt="Invoice preview" className="preview-image" />
            ) : (
              <div className="pdf-preview">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M13 3v6a1 1 0 001 1h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="pdf-name">{file.name}</p>
                <p className="pdf-size">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            )}
            <div className="preview-overlay">
              <button className="button-icon" onClick={(e) => { e.stopPropagation(); handleReset(); }} title="Remove" type="button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-error">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {file && (
        <div className="action-bar">
          <button className="button-outline" onClick={handleReset} type="button">
            Cancel
          </button>
          <button className="button-primary" onClick={handleSubmit} type="button">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Process Invoice
          </button>
        </div>
      )}
    </div>
  );
}
