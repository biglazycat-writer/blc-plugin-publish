import { useThemes } from './lib/editor-themes/theme-store';
import { setThemeId, useThemeId } from './lib/theme';
export default function ThemePicker() {
  const themes = useThemes(), { themeId } = useThemeId();
  return <label className="themePicker">排版主题 <select value={themeId} onChange={event => setThemeId(event.target.value)}>
    {themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
  </select></label>;
}
