// AG Grid (community) setup shared by the quote, BOM, measurement and ledger tables.
import { AllCommunityModule, ModuleRegistry, colorSchemeDark, themeQuartz } from 'ag-grid-community'

ModuleRegistry.registerModules([AllCommunityModule])

export const gridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: '#0b1017',
  foregroundColor: '#e9eef6',
  headerBackgroundColor: '#101722',
  headerTextColor: '#8a95a8',
  borderColor: '#1d2533',
  rowBorder: { color: '#161e2a' },
  accentColor: '#7cf2c4',
  fontFamily: { googleFont: 'Inter' },
  fontSize: 14,
  headerFontSize: 12,
  headerFontWeight: 600,
  rowHeight: 40,
  headerHeight: 38,
  wrapperBorderRadius: 12,
  oddRowBackgroundColor: '#0d131c',
  spacing: 7,
})

export const usd = (p: { value: number | null | undefined }) => (p.value == null ? '' : '$' + Number(p.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
