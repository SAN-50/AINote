import React, { useState } from 'react';

export function CustomSelect({ value, onChange, options, onOpenChange, isSmall }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = (nextState) => {
    setIsOpen(nextState);
    if (onOpenChange) onOpenChange(nextState);
  };

  return (
    <div className="relative w-full sm:w-auto min-w-[140px]">
      {isOpen && <div className="fixed inset-0 z-40" onClick={() => handleToggle(false)} />}
      <button
        type="button"
        onClick={() => handleToggle(!isOpen)}
        className={`relative z-50 w-full bg-gray-100/80 dark:bg-[#2A2A2C]/80 text-gray-800 dark:text-gray-200 px-4 flex justify-between items-center shadow-sm transition-all hover:bg-gray-200 dark:hover:bg-[#353538] ${
          isSmall ? 'py-2.5 rounded-xl text-sm font-semibold' : 'py-3.5 rounded-xl text-sm font-bold'
        } ${isOpen ? 'ring-2 ring-samsung-blue ring-opacity-50' : ''}`}
      >
        <span className="truncate pr-3">{value}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          className={`text-gray-500 transition-transform duration-300 shrink-0 ${isOpen ? 'rotate-180' : ''}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute top-[calc(100%+8px)] left-0 w-full bg-white/95 dark:bg-[#252527]/95 backdrop-blur-md border border-gray-100 dark:border-samsung-border rounded-xl shadow-2xl z-50 py-2 overflow-hidden animate-[slideDown_0.2s_ease-out]">
          <ul className="flex flex-col">
            {options.map((c) => (
              <li
                key={c}
                onClick={() => {
                  onChange(c);
                  handleToggle(false);
                }}
                className={`px-5 py-3 text-sm font-bold cursor-pointer transition-colors flex items-center gap-2 ${
                  value === c
                    ? 'text-samsung-blue dark:text-blue-400 bg-samsung-blue/5 dark:bg-black/20'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5'
                }`}
              >
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
