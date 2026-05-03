import React from 'react';
import { Package, Utensils } from 'lucide-react';

interface GroceriesIconProps {
  className?: string;
}

export const GroceriesIcon = ({ className = "w-6 h-6 text-gray-900" }: GroceriesIconProps) => {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <Package className="w-full h-full text-current" strokeWidth={1.5} />
    </div>
  );
};
