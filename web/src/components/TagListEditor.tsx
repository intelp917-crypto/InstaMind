import { useState } from 'react';

interface Props {
  value: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}

/**
 * مولتی‌لاین لیست موضوعات: هر خط یک مورد
 */
export default function TagListEditor({ value, onChange, placeholder }: Props) {
  const [text, setText] = useState(value.join('\n'));
  const [dirty, setDirty] = useState(false);

  const shown = dirty ? text : value.join('\n');

  const update = (next: string) => {
    setText(next);
    setDirty(true);
  };

  const commit = () => {
    onChange(
      text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    );
    setDirty(false);
  };

  return (
    <textarea
      className="im-textarea"
      value={shown}
      onChange={e => update(e.target.value)}
      onBlur={commit}
      placeholder={placeholder ?? 'هر خط یک مورد'}
      dir="auto"
    />
  );
}
