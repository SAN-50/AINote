import React, { useState } from 'react';

export function CustomSelect({ value, onChange, options, onOpenChange, isSmall }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = (nextState) => {
    setIsOpen(nextState);
    if (onOpenChange) onOpenChange(nextState);
  };

  return (
    <div className="relative w-full sm:w-auto min-w-[136px]">
      {isOpen && <div className="fixed inset-0 z-40" onClick={() => handleToggle(false)} />}
      <button
        type="button"
        onClick={() => handleToggle(!isOpen)}
        className={`relative z-50 w-full bg-muted-light dark:bg-muted-dark border border-line-light dark:border-line-dark text-zinc-800 dark:text-zinc-200 px-3.5 flex justify-between items-center transition-colors hover:border-zinc-400 dark:hover:border-zinc-600 ${
          isSmall ? 'py-2 rounded-xl text-xs font-semibold' : 'py-2.5 rounded-xl text-xs font-bold'
        } ${isOpen ? 'ring-2 ring-blue-600/30 border-blue-600' : ''}`}
      >
        <span className="truncate pr-2">{value}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          className={`text-zinc-500 transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute top-[calc(100%+6px)] left-0 w-full bg-surface-light dark:bg-surface-dark border border-line-light dark:border-line-dark rounded-xl shadow-xl z-50 py-1.5 overflow-hidden animate-modal">
          <ul className="flex flex-col max-h-64 overflow-y-auto">
            {options.map((c) => (
              <li
                key={c}
                onClick={() => {
                  onChange(c);
                  handleToggle(false);
                }}
                className={`px-3.5 py-2 text-xs font-semibold cursor-pointer transition-colors flex items-center gap-2 ${
                  value === c
                    ? 'text-blue-600 dark:text-blue-400 bg-blue-600/10'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-muted-light dark:hover:bg-muted-dark'
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
