import React from 'react';

interface GroceriesIconProps {
  className?: string;
}

export const GroceriesIcon = ({ className = "w-6 h-6" }: GroceriesIconProps) => {
  return (
    <img 
      src="/grocery.png" 
      alt="Shelf Control" 
      className={className} 
      referrerPolicy="no-referrer"
    />
  );
};
