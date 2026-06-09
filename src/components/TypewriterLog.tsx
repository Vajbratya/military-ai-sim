import { useState, useEffect } from 'react';
import { audioSystem } from '../audio';

interface TypewriterLogProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
}

export function TypewriterLog({ text, speed = 25, onComplete }: TypewriterLogProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // Reset state if text changes completely
    setDisplayedText('');
    setIndex(0);
  }, [text]);

  useEffect(() => {
    if (index < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText((prev) => prev + text.charAt(index));
        setIndex((prev) => prev + 1);
        
        // Play sound occasionally to avoid audio clipping
        if (index % 3 === 0) {
          audioSystem.playTypewriter();
        }
      }, speed);
      return () => clearTimeout(timeout);
    } else {
      if (onComplete) onComplete();
    }
  }, [index, text, speed, onComplete]);

  return <span style={{ fontFamily: 'var(--font-mono)' }}>{displayedText}</span>;
}
