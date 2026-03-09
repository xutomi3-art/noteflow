"use client";

import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-[13px] font-medium text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`
            w-full px-3.5 py-2.5 text-[15px]
            bg-[var(--card-bg)] border border-[var(--border)]
            rounded-xl outline-none
            transition-all duration-200
            placeholder:text-[var(--text-tertiary)]
            focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20
            ${error ? "border-[var(--danger)]" : ""}
            ${className}
          `}
          {...props}
        />
        {error && (
          <span className="text-[12px] text-[var(--danger)]">{error}</span>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
