// TorqDrop palette: dashboard-dark first, electric orange accent. Orange carries dark text, which
// reads better than white on it. Status colours (good/attention/defect) live in components/inspection/status.
const primary = '#FF6A1A';
const onPrimary = '#140A03';

export default {
  dark: {
    text: '#F2F4F7',
    textMuted: '#A3AAB6',
    textSubtle: '#6E7684',
    background: '#0B0D10',
    surface: '#15181D',
    surfaceRaised: '#1E2229',
    border: '#2A2F38',
    primary,
    onPrimary,
    primarySoft: 'rgba(255,106,26,0.14)',
    // Accent for links and icons on the background.
    tint: '#FF8A4C',
    danger: '#FF5C5C',
    // Data series (validated against the surface, see the dataviz palette). Orange stays for actions.
    chart: '#3987e5',
    tabIconDefault: '#6E7684',
    tabIconSelected: primary,
  },
  light: {
    text: '#0E1116',
    textMuted: '#5A6270',
    textSubtle: '#8A92A0',
    background: '#F3F4F6',
    surface: '#FFFFFF',
    surfaceRaised: '#ECEEF1',
    border: '#DFE2E7',
    primary,
    onPrimary,
    primarySoft: 'rgba(255,106,26,0.12)',
    tint: '#C2470A',
    danger: '#C62828',
    chart: '#2a78d6',
    tabIconDefault: '#8A92A0',
    tabIconSelected: '#C2470A',
  },
};
