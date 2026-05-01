import React from 'react';
import groceryIcon from '../assets/grocery.png';

interface GroceriesIconProps {
  className?: string;
}

export const GroceriesIcon = ({ className = "w-6 h-6" }: GroceriesIconProps) => {
  return (
    <img 
      src={groceryIcon} 
      alt="Shelf Control" 
      className={className} 
    />
  );
};
