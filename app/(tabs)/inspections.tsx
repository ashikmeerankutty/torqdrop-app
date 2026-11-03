import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useTheme } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { InspectionRow } from '@/components/inspection/InspectionRow';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { TextField } from '@/components/ui/TextField';
import { space } from '@/constants/Theme';
import { useInspections } from '@/lib/firebase/use-inspections';

const FILTERS = { all: 'All', open: 'In progress', complete: 'Complete' } as const;
type Filter = keyof typeof FILTERS;

export default function InspectionsScreen() {
  const { colors } = useTheme();
  const inspections = useInspections();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase().replace(/\s+/g, '');
  const shown = (inspections ?? []).filter((i) => {
    if (filter === 'open' && i.status === 'complete') return false;
    if (filter === 'complete' && i.status !== 'complete') return false;
    if (!q) return true;
    const v = i.vehicle;
    return `${v.regNo}${v.make}${v.model}${v.variant ?? ''}`.toLowerCase().replace(/\s+/g, '').includes(q);
  });
  const hasAny = !!inspections?.length;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={shown}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          hasAny ? (
            <View style={styles.header}>
              <TextField
                placeholder="Search registration, make or model"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                returnKeyType="search"
                suffix={<Icon name="search" size={20} tone="textSubtle" />}
              />
              <View style={styles.chips}>
                {(Object.keys(FILTERS) as Filter[]).map((f) => (
                  <Chip key={f} label={FILTERS[f]} selected={filter === f} onPress={() => setFilter(f)} />
                ))}
              </View>
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          !inspections ? undefined : hasAny ? (
            <EmptyState icon="search" title="No matches" body="Try a different search or filter." />
          ) : (
            <EmptyState
              icon="inspections"
              title="No inspections yet"
              body="Start one to check a car section by section. Everything saves on the phone, even offline."
              action={<Button title="Start new inspection" icon="add" onPress={() => router.push('/inspection/new')} />}
            />
          )
        }
        renderItem={({ item }) => <InspectionRow inspection={item} />}
      />
      {hasAny && (
        <View style={styles.fab}>
          <Button title="New" icon="add" onPress={() => router.push('/inspection/new')} style={styles.fabButton} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: space.lg, gap: space.md, paddingBottom: 96 },
  header: { gap: space.md },
  chips: { flexDirection: 'row', gap: space.sm },
  fab: { position: 'absolute', right: space.lg, bottom: space.lg },
  fabButton: {
    borderRadius: 28,
    paddingHorizontal: space.xl,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
