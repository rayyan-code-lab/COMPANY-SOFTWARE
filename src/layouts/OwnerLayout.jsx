import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useOwnerLayoutData } from '@/hooks/useOwnerLayoutData';
import { APP_CONFIG } from '@/config/app.config';
import { cn } from '@/lib/utils';
import ApperIcon from '@/components/ApperIcon';
import UserMenu from '@/components/UserMenu';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export default function OwnerLayout() {
  const { user, logout, homeRoute, navItems, navGroups, initials, displayName, counts } = useOwnerLayoutData();
  const [navOpen, setNavOpen] = useState(false);
  const groups = navGroups.length ? navGroups : [{ label: null, items: navItems }];

  const renderNav = (mobile = false) => (
    <div className="space-y-6">
      {groups.map((group, index) => (
        <section key={group.label ?? index} className="space-y-1.5">
          {group.label && <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{group.label}</p>}
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => mobile && setNavOpen(false)}
              className={({ isActive }) => cn('group flex min-h-10 items-center gap-3 rounded-sm px-3 text-sm transition-colors',
                isActive ? 'bg-sidebar-primary text-sidebar-primary-foreground font-semibold' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}>
              <ApperIcon name={item.icon ?? 'Circle'} size={17} />
              <span className="flex-1">{item.label}</span>
              {counts[item.to] != null && <span className="text-xs opacity-70">{counts[item.to]}</span>}
            </NavLink>
          ))}
        </section>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <Link to={homeRoute} className="flex h-20 items-center gap-3 border-b border-sidebar-border px-6">
          <span className="flex size-10 items-center justify-center rounded-sm bg-primary text-primary-foreground"><ApperIcon name="Factory" size={21} /></span>
          <span><span className="block font-heading text-xl font-bold tracking-tight">{APP_CONFIG.name}</span><span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Company operations</span></span>
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 py-6">{renderNav()}</nav>
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 rounded-sm bg-muted/60 p-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold">{initials}</span>
            <div className="min-w-0"><p className="truncate text-sm font-medium">{displayName}</p><p className="text-xs text-muted-foreground">{user?.profile === 'Admin_c' ? 'Administrator' : 'Manager access'}</p></div>
          </div>
          <div className="mt-3"><UserMenu user={user} initials={initials} displayName={displayName} logout={logout} /></div>
        </div>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur md:px-7">
          <button type="button" className="rounded-sm p-2 hover:bg-accent lg:hidden" onClick={() => setNavOpen((value) => !value)} aria-label="Toggle navigation"><ApperIcon name="Menu" size={20} /></button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-highlight" /> Operations workspace</div>
          <div className="ml-auto flex items-center gap-3"><span className="hidden text-xs text-muted-foreground sm:inline">India Standard Time</span><UserMenu user={user} initials={initials} displayName={displayName} logout={logout} /></div>
        </header>
        {navOpen && <div className="fixed inset-0 z-40 bg-background lg:hidden">
          <div className="flex h-16 items-center justify-between border-b border-border px-5"><span className="font-heading text-xl font-bold">{APP_CONFIG.name}</span><button type="button" onClick={() => setNavOpen(false)} className="rounded-sm p-2 hover:bg-accent" aria-label="Close navigation"><ApperIcon name="X" size={20} /></button></div>
          <nav className="overflow-y-auto p-4">{renderNav(true)}</nav>
        </div>}
        <main className="mx-auto max-w-[1600px] p-4 md:p-7 xl:p-8"><ErrorBoundary><Outlet /></ErrorBoundary></main>
      </div>
    </div>
  );
}