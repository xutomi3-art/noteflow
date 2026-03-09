'use client';
import React from 'react';

type PanelTab = 'sources' | 'chat' | 'studio';

interface MobileTabsProps {
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
}

export default function MobileTabs({ activeTab, onTabChange }: MobileTabsProps) {
  const tabs: { key: PanelTab; label: string }[] = [
    { key: 'sources', label: 'Sources' },
    { key: 'chat', label: 'Chat' },
    { key: 'studio', label: 'Studio' },
  ];

  return (
    <div className="flex border-b border-gray-200 bg-white lg:hidden">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === tab.key
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
