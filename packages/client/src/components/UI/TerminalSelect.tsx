import Select, { StylesConfig, GroupBase } from 'react-select';
import { playHover, playSelect } from '../../utils/sounds';

interface Option {
  value: string;
  label: string;
}

interface TerminalSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function TerminalSelect({ options, value, onChange, placeholder }: TerminalSelectProps) {
  const selectedOption = options.find(opt => opt.value === value) || null;

  const customStyles: StylesConfig<Option, false, GroupBase<Option>> = {
    control: (base, state) => ({
      ...base,
      background: 'var(--term-bg)',
      borderColor: state.isFocused ? 'var(--term-fg)' : 'var(--term-border)',
      borderRadius: 0,
      boxShadow: state.isFocused ? '0 0 10px var(--term-glow)' : 'none',
      fontFamily: 'var(--font-mono)',
      fontSize: '16px',
      padding: '4px 8px',
      cursor: 'pointer',
      '&:hover': {
        borderColor: 'var(--term-fg)',
      },
    }),
    menu: (base) => ({
      ...base,
      background: 'var(--term-bg)',
      border: '1px solid var(--term-fg)',
      borderRadius: 0,
      boxShadow: '0 0 20px var(--term-glow)',
      marginTop: '2px',
    }),
    menuList: (base) => ({
      ...base,
      padding: 0,
    }),
    option: (base, state) => ({
      ...base,
      background: state.isSelected
        ? 'var(--term-fg)'
        : state.isFocused
        ? 'rgba(255, 255, 255, 0.1)'
        : 'transparent',
      color: state.isSelected ? 'var(--term-bg)' : 'var(--term-fg)',
      fontFamily: 'var(--font-mono)',
      fontSize: '16px',
      padding: '12px 16px',
      cursor: 'pointer',
      '&:before': {
        content: state.isSelected ? '"[X] "' : state.isFocused ? '"> "' : '"  "',
        fontFamily: 'var(--font-mono)',
      },
      '&:active': {
        background: 'var(--term-fg)',
        color: 'var(--term-bg)',
      },
    }),
    singleValue: (base) => ({
      ...base,
      color: 'var(--term-fg)',
      fontFamily: 'var(--font-mono)',
    }),
    placeholder: (base) => ({
      ...base,
      color: 'var(--term-dim)',
      fontFamily: 'var(--font-mono)',
    }),
    input: (base) => ({
      ...base,
      color: 'var(--term-fg)',
      fontFamily: 'var(--font-mono)',
    }),
    indicatorSeparator: () => ({
      display: 'none',
    }),
    dropdownIndicator: (base, state) => ({
      ...base,
      color: state.isFocused ? 'var(--term-fg)' : 'var(--term-dim)',
      '&:hover': {
        color: 'var(--term-fg)',
      },
      transition: 'transform 0.2s',
      transform: state.selectProps.menuIsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
    }),
  };

  return (
    <Select
      options={options}
      value={selectedOption}
      onChange={(opt) => {
        if (opt) {
          playSelect();
          onChange(opt.value);
        }
      }}
      onMenuOpen={() => playHover()}
      styles={customStyles}
      placeholder={placeholder}
      isSearchable={false}
      components={{
        IndicatorSeparator: () => null,
      }}
    />
  );
}
