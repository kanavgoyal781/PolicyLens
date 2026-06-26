"use client";

// Drag+click PDF uploader. Client-side only .pdf check; actual parse on server.
// Calls parent handleUpload which sets loading + fetch.

import React, { useRef, useState, useCallback } from "react";

interface UploadDropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
  onError?: (msg: string) => void;
}

export default function UploadDropzone({ onFile, disabled, onError }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Validate PDF client-side; delegate to parent (which does network).
  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      const msg = "Please upload a PDF file.";
      if (onError) onError(msg); else alert(msg);
      return;
    }
    onFile(file);
  }, [onFile, onError]);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);

  const onClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div
      onClick={onClick}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`btn btn-secondary border-dashed flex items-center gap-2 ${isDragging ? "border-[#2563eb] bg-[#f7f9fc]" : ""} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      style={{ borderStyle: "dashed" }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
      <span>📄 Upload policy (PDF)</span>
    </div>
  );
}
