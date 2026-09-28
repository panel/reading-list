/** Opens the ⌘K palette from anywhere (e.g. the header's search button). */
class PaletteStore {
	open = $state(false);
}

export const palette = new PaletteStore();
