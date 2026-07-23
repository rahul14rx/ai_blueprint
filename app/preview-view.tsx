"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, AlertCircle, Image as ImageIcon } from "lucide-react";
import { FloorPlan } from "./studio-types";

interface PreviewViewProps {
  plan: FloorPlan;
  blueprintImage?: string;
  previewVersions?: string[];
  onPreviewGenerated?: (url: string) => void;
}

export default function PreviewView({ plan, blueprintImage, previewVersions = [], onPreviewGenerated }: PreviewViewProps) {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [selectedVersionIndex, setSelectedVersionIndex] = useState<number>(previewVersions.length ? previewVersions.length - 1 : -1);
  const [loading, setLoading] = useState<boolean>(previewVersions.length === 0);
  const [error, setError] = useState<string>("");
  const selectedVersionUrl = selectedVersionIndex >= 0 ? previewVersions[selectedVersionIndex] : "";
  const currentImageUrl = selectedVersionUrl || imageUrl;

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/generate-preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan, blueprintImage }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate preview image.");
      }
      setSelectedVersionIndex(-1);
      setImageUrl(data.imageUrl);
      if (onPreviewGenerated) {
        onPreviewGenerated(data.imageUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred while generating the preview.");
    } finally {
      setLoading(false);
    }
  }, [blueprintImage, onPreviewGenerated, plan]);

  useEffect(() => {
    if (!previewVersions.length) {
      const timer = window.setTimeout(() => {
        void fetchPreview();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [fetchPreview, plan.id, previewVersions.length]);

  const handleVersionChange = (index: number) => {
    if (previewVersions && previewVersions[index]) {
      setSelectedVersionIndex(index);
      setError("");
    }
  };

  const handleDownload = () => {
    if (!currentImageUrl) return;
    const link = document.createElement("a");
    link.href = currentImageUrl;
    link.download = `blueprint-preview-${plan.id}-v${selectedVersionIndex + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="preview-container" style={{ display: "flex", flexDirection: "column", gap: "20px", height: "100%", padding: "20px", overflowY: "auto" }}>
      <div className="preview-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", color: "#111827" }}>Photorealistic 2D Render</h3>
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#6B7280" }}>Generated via Gemini/Imagen based on your room configuration</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Version Selector Dropdown */}
          {previewVersions.length > 0 && (
            <select
              value={selectedVersionIndex}
              onChange={(e) => handleVersionChange(Number(e.target.value))}
              style={{
                padding: "8px 12px",
                fontSize: "13px",
                borderRadius: "6px",
                border: "1px solid #D1D5DB",
                background: "#FFFFFF",
                color: "#374151",
                cursor: "pointer",
                outline: "none",
                fontWeight: 500
              }}
            >
              {previewVersions.map((_, idx) => (
                <option key={idx} value={idx}>
                  Version {idx + 1} {idx === previewVersions.length - 1 ? "(Latest)" : ""}
                </option>
              ))}
            </select>
          )}

          <button 
            className="secondary-btn" 
            onClick={fetchPreview} 
            disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", padding: "8px 12px" }}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            Regenerate
          </button>
          
          <button 
            className="primary-btn" 
            onClick={handleDownload} 
            disabled={loading || !currentImageUrl}
            style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", padding: "8px 12px" }}
          >
            <Download size={15} />
            Export Image
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px", flex: 1, minHeight: "450px" }}>
        {/* Main image canvas (Full width) */}
        <div 
          style={{ 
            background: "#F3F4F6", 
            borderRadius: "8px", 
            border: "1px solid #E5E7EB", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            position: "relative",
            minHeight: "680px",
            overflow: "auto",
            width: "100%"
          }}
        >
          {currentImageUrl && (
            <img 
              src={currentImageUrl} 
              alt="Floor plan architectural render" 
              style={{ width: "auto", height: "min(560px, 76vh)", maxWidth: "88%", objectFit: "contain", display: "block" }} 
            />
          )}

          {/* Loading Overlay */}
          {loading && (
            <div style={{ 
              position: "absolute",
              top: 0, left: 0, right: 0, bottom: 0,
              background: currentImageUrl ? "rgba(243, 244, 246, 0.7)" : "#F3F4F6",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              zIndex: 10
            }}>
              <div className="animate-spin" style={{ width: "32px", height: "32px", border: "3px solid #D1D5DB", borderTopColor: "#EF7545", borderRadius: "50%" }}></div>
              <span style={{ fontSize: "13px", color: "#4B5563", fontWeight: 500 }}>Generating realistic floor plan...</span>
            </div>
          )}

          {/* Error Overlay / Banner */}
          {error && !currentImageUrl ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "20px", textAlign: "center", zIndex: 15 }}>
              <AlertCircle size={32} color="#EF4444" />
              <span style={{ fontSize: "14px", color: "#EF4444", fontWeight: "bold" }}>Generation Error</span>
              <span style={{ fontSize: "12px", color: "#4B5563", maxWidth: "340px" }}>{error}</span>
              <button className="secondary-btn" onClick={fetchPreview} style={{ marginTop: "10px" }}>Try Again</button>
            </div>
          ) : error && (
            <div style={{ 
              position: "absolute",
              top: 0, left: 0, right: 0,
              background: "#FEE2E2",
              borderBottom: "1px solid #FCA5A5",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              zIndex: 20
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <AlertCircle size={16} color="#EF4444" />
                <span style={{ fontSize: "12px", color: "#B91C1C", fontWeight: 500 }}>{error}</span>
              </div>
              <button className="secondary-btn" onClick={fetchPreview} style={{ padding: "4px 8px", fontSize: "11px" }}>Retry</button>
            </div>
          )}

          {/* Initial Blank State (only shown if not loading, no error, and no image) */}
          {!currentImageUrl && !loading && !error && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", color: "#9CA3AF" }}>
              <ImageIcon size={40} />
              <span style={{ fontSize: "13px" }}>No preview generated yet.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
