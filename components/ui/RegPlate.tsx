import { StyleSheet, Text, View } from 'react-native';

/** Registration number styled like an Indian number plate, so it reads at a glance in lists. */
export function RegPlate({ regNo, size = 'md' }: { regNo: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = SIZES[size];
  return (
    <View style={[styles.plate, { height: s.height }]} accessibilityLabel={`Registration ${regNo}`}>
      <View style={[styles.strip, { width: s.strip }]}>
        <Text style={[styles.ind, { fontSize: s.ind }]}>IND</Text>
      </View>
      <Text style={[styles.reg, { fontSize: s.font, paddingHorizontal: s.pad }]}>{formatReg(regNo)}</Text>
    </View>
  );
}

const SIZES = {
  sm: { height: 24, font: 13, ind: 6, strip: 12, pad: 6 },
  md: { height: 30, font: 16, ind: 7, strip: 14, pad: 8 },
  lg: { height: 40, font: 22, ind: 8, strip: 18, pad: 12 },
};

/** KA01AB1234 → KA 01 AB 1234. Anything that doesn't match is shown as typed. */
export function formatReg(regNo: string) {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(regNo);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : regNo;
}

const styles = StyleSheet.create({
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#F7F7F2',
    borderColor: '#1a1a1a',
    borderWidth: 1.5,
    borderRadius: 5,
    overflow: 'hidden',
  },
  strip: { alignSelf: 'stretch', backgroundColor: '#1E4FB8', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2 },
  ind: { color: '#fff', fontWeight: '800' },
  reg: { color: '#111', fontWeight: '800', letterSpacing: 1, fontVariant: ['tabular-nums'] },
});
