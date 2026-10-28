"use client";

export function TerminalMockup() {
  return (
    <div className="my-5 rounded-xl border border-[--code-border] bg-[#1a1a1a] overflow-hidden shadow-lg">
      {/* Terminal header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#2d2d2d] border-b border-[#3d3d3d]">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="text-xs text-[#888] ml-2 font-mono">Terminal</span>
      </div>
      
      {/* Terminal content */}
      <div className="p-6 font-mono text-sm">
        {/* BROSKI title */}
        <div className="text-center mb-4">
          <span className="text-[#FAB283] text-lg tracking-[0.3em] font-bold">BROSKI</span>
        </div>
        
        {/* Instruction */}
        <div className="text-center text-[#888] mb-4">
          Scan this QR code with Broski:
        </div>
        
        {/* QR Code mockup - static pattern */}
        <div className="flex justify-center mb-4">
          <div className="bg-white p-3 rounded">
            <svg width="100" height="100" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Top-left finder pattern */}
              <rect x="0" y="0" width="7" height="7" fill="black"/>
              <rect x="1" y="1" width="5" height="5" fill="white"/>
              <rect x="2" y="2" width="3" height="3" fill="black"/>
              
              {/* Top-right finder pattern */}
              <rect x="14" y="0" width="7" height="7" fill="black"/>
              <rect x="15" y="1" width="5" height="5" fill="white"/>
              <rect x="16" y="2" width="3" height="3" fill="black"/>
              
              {/* Bottom-left finder pattern */}
              <rect x="0" y="14" width="7" height="7" fill="black"/>
              <rect x="1" y="15" width="5" height="5" fill="white"/>
              <rect x="2" y="16" width="3" height="3" fill="black"/>
              
              {/* Data modules - static pattern */}
              <rect x="8" y="0" width="1" height="1" fill="black"/>
              <rect x="10" y="0" width="1" height="1" fill="black"/>
              <rect x="8" y="2" width="1" height="1" fill="black"/>
              <rect x="10" y="2" width="1" height="1" fill="black"/>
              <rect x="12" y="2" width="1" height="1" fill="black"/>
              <rect x="8" y="4" width="1" height="1" fill="black"/>
              <rect x="11" y="4" width="1" height="1" fill="black"/>
              <rect x="8" y="6" width="1" height="1" fill="black"/>
              <rect x="10" y="6" width="1" height="1" fill="black"/>
              <rect x="12" y="6" width="1" height="1" fill="black"/>
              
              <rect x="0" y="8" width="1" height="1" fill="black"/>
              <rect x="2" y="8" width="1" height="1" fill="black"/>
              <rect x="4" y="8" width="1" height="1" fill="black"/>
              <rect x="6" y="8" width="1" height="1" fill="black"/>
              <rect x="8" y="8" width="1" height="1" fill="black"/>
              <rect x="10" y="8" width="1" height="1" fill="black"/>
              <rect x="12" y="8" width="1" height="1" fill="black"/>
              <rect x="14" y="8" width="1" height="1" fill="black"/>
              <rect x="16" y="8" width="1" height="1" fill="black"/>
              <rect x="18" y="8" width="1" height="1" fill="black"/>
              <rect x="20" y="8" width="1" height="1" fill="black"/>
              
              <rect x="8" y="10" width="1" height="1" fill="black"/>
              <rect x="11" y="10" width="1" height="1" fill="black"/>
              <rect x="8" y="12" width="1" height="1" fill="black"/>
              <rect x="10" y="12" width="1" height="1" fill="black"/>
              <rect x="12" y="12" width="1" height="1" fill="black"/>
              
              <rect x="8" y="14" width="1" height="1" fill="black"/>
              <rect x="10" y="14" width="1" height="1" fill="black"/>
              <rect x="8" y="16" width="1" height="1" fill="black"/>
              <rect x="11" y="16" width="1" height="1" fill="black"/>
              <rect x="8" y="18" width="1" height="1" fill="black"/>
              <rect x="10" y="18" width="1" height="1" fill="black"/>
              <rect x="12" y="18" width="1" height="1" fill="black"/>
              <rect x="8" y="20" width="1" height="1" fill="black"/>
              <rect x="10" y="20" width="1" height="1" fill="black"/>
              
              <rect x="14" y="10" width="1" height="1" fill="black"/>
              <rect x="16" y="10" width="1" height="1" fill="black"/>
              <rect x="18" y="10" width="1" height="1" fill="black"/>
              <rect x="20" y="10" width="1" height="1" fill="black"/>
              <rect x="14" y="12" width="1" height="1" fill="black"/>
              <rect x="17" y="12" width="1" height="1" fill="black"/>
              <rect x="19" y="12" width="1" height="1" fill="black"/>
              <rect x="14" y="14" width="1" height="1" fill="black"/>
              <rect x="16" y="14" width="1" height="1" fill="black"/>
              <rect x="18" y="14" width="1" height="1" fill="black"/>
              <rect x="20" y="14" width="1" height="1" fill="black"/>
              <rect x="15" y="16" width="1" height="1" fill="black"/>
              <rect x="17" y="16" width="1" height="1" fill="black"/>
              <rect x="19" y="16" width="1" height="1" fill="black"/>
              <rect x="14" y="18" width="1" height="1" fill="black"/>
              <rect x="16" y="18" width="1" height="1" fill="black"/>
              <rect x="18" y="18" width="1" height="1" fill="black"/>
              <rect x="20" y="18" width="1" height="1" fill="black"/>
              <rect x="14" y="20" width="1" height="1" fill="black"/>
              <rect x="17" y="20" width="1" height="1" fill="black"/>
              <rect x="20" y="20" width="1" height="1" fill="black"/>
            </svg>
          </div>
        </div>
        
        {/* Connection info */}
        <div className="space-y-1 text-center">
          <div className="flex justify-center gap-4">
            <span className="text-[#888]">Local:</span>
            <span className="text-[#7ee787]">broski-link 192.168.1.5:18275</span>
          </div>
          <div className="flex justify-center gap-4">
            <span className="text-[#888]">Status:</span>
            <span className="text-[#ffa657]">Waiting for phone...</span>
          </div>
        </div>
      </div>
    </div>
  );
}
