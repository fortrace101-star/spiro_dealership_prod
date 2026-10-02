import { PageHeader } from '../components/ui'

/**
 * Settings was reorganised:
 *  - Period reports (range KPI + graph + revenue/stats cards) moved to the
 *    Overview page and are now filterable from the period dropdown at the top.
 *  - Staff performance moved to the "Team & Activation Codes" page (bottom of
 *    the page, under the activation-codes + users cards).
 *  - The notifications overview and the change-password form were removed.
 *
 * This page is kept as a stub so the nav entry and route stay stable until the
 * product decides whether to drop Settings entirely.
 */
export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" />
    </div>
  )
}
