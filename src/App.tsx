import React, { useMemo, useState, useRef } from 'react';
import { extractInvoice } from './api';
import { ExtractResponse } from './types';

const defaultApiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5678';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [apiBaseUrl] = useState(defaultApiBase);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => {
    if (!file) return null;
    return previewUrl ?? URL.createObjectURL(file);
  }, [file, previewUrl]);

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setStatus('idle');
    setResult(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
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

  const handleSubmit = async () => {
    if (!file) {
      setError('Please select an invoice first.');
      return;
    }
    setStatus('uploading');
    setError(null);
    setResult(null);

    try {
      const response = await extractInvoice({ file, apiBaseUrl, useOcrFirst: true });
      setResult(response);
      setStatus('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      setError(message);
      setStatus('error');
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreviewUrl(null);
    setError(null);
    setStatus('idle');
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="page">
      <header className="header">
        <div className="header-content">
          <div className="header-left">
            <div className="logo-container">
              <svg className="logo-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 12h6M9 16h6M12 8V6M8 20h8a2 2 0 002-2V6a2 2 0 00-2-2h-2.172a2 2 0 00-1.414.586l-1.828 1.828A2 2 0 019.172 7H8a2 2 0 00-2 2v9a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div>
                <h1>Invoice Capture</h1>
                <p className="subtitle">ERP System - Document Processing</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="main-content">
        {status === 'idle' || status === 'error' ? (
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
                      <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <h3>Drop invoice here or click to browse</h3>
                  <p className="dropzone-hint">Supports JPEG, PNG, PDF • Max 10MB</p>
                  <div className="upload-buttons">
                    <button className="button-secondary" type="button">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Take Photo
                    </button>
                  </div>
        </div>
              ) : (
                <div className="preview-container">
                  {file.type.startsWith('image/') ? (
                    <img src={preview!} alt="Invoice preview" className="preview-image" />
                  ) : (
                    <div className="pdf-preview">
                      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M13 3v6a1 1 0 001 1h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <p className="pdf-name">{file.name}</p>
                      <p className="pdf-size">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
                  )}
                  <div className="preview-overlay">
                    <button className="button-icon" onClick={(e) => { e.stopPropagation(); handleReset(); }} title="Remove">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
          </button>
                  </div>
                </div>
          )}
        </div>

            {error && (
              <div className="alert alert-error">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>{error}</span>
              </div>
            )}

            {file && (
              <div className="action-bar">
                <button className="button-outline" onClick={handleReset}>
                  Cancel
                </button>
                <button className="button-primary" onClick={handleSubmit}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Process Invoice
                </button>
              </div>
            )}
          </div>
        ) : status === 'uploading' ? (
          <div className="processing-card">
            <div className="spinner-container">
              <div className="spinner"></div>
            </div>
            <h2>Processing Invoice</h2>
            <p className="processing-text">Extracting data from your document...</p>
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
        ) : (
          <div className="success-card">
            <div className="success-icon-container">
              <svg className="success-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2>Invoice Processed Successfully</h2>
            <p className="success-text">Data has been extracted and is ready for import</p>
            
            {result?.data && (
              <div className="invoice-summary">
                <div className="summary-row">
                  <span className="summary-label">Invoice Number:</span>
                  <span className="summary-value">{result.data.invoiceNumber || 'N/A'}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Date:</span>
                  <span className="summary-value">{result.data.invoiceDate || 'N/A'}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Vendor:</span>
                  <span className="summary-value">{result.data.vendorName || 'N/A'}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Total Amount:</span>
                  <span className="summary-value strong">
                    {result.data.totalAmount ? `${result.data.totalAmount} ${result.data.currency || ''}` : 'N/A'}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Items:</span>
                  <span className="summary-value">{result.data.items?.length || 0} items</span>
                </div>
              </div>
            )}

            <div className="action-bar">
              <button className="button-outline" onClick={() => setShowDebug(!showDebug)}>
                {showDebug ? 'Hide' : 'View'} Raw Data
              </button>
              <button className="button-primary" onClick={handleReset}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 4v16m8-8H4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Process Another Invoice
              </button>
            </div>

            {showDebug && (
              <div className="debug-section">
                <h3>Debug Information</h3>
                <div className="result-json">
                  <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>
          </div>
        )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

