import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { CreateCompanyDialog } from '@/features/companies/create-company-dialog';
import { CreateContactDialog } from '@/features/contacts/create-contact-dialog';
import { CreateDealDialog } from '@/features/deals/create-deal-dialog';
import { usePipelines } from '@/features/pipelines/api';

/**
 * Global Cmd/Ctrl-K palette. Holds command definitions inline for now;
 * Sub-Plans 4+ can extract a registry if the list grows past ~20 entries.
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [createDealOpen, setCreateDealOpen] = useState(false);
  const pipelinesQuery = usePipelines();
  const defaultPipeline = pipelinesQuery.data?.pipelines[0];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Create">
            <CommandItem onSelect={() => run(() => setCreateContactOpen(true))}>
              Create contact
              <CommandShortcut>C C</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => setCreateCompanyOpen(true))}>
              Create company
              <CommandShortcut>C O</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() => {
                  if (defaultPipeline) setCreateDealOpen(true);
                })
              }
            >
              Create deal
              <CommandShortcut>C D</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => run(() => void navigate({ to: '/app/contacts' }))}>
              Contacts
              <CommandShortcut>G C</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => void navigate({ to: '/app/companies' }))}>
              Companies
              <CommandShortcut>G O</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => void navigate({ to: '/app/deals' }))}>
              Deals
              <CommandShortcut>G D</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => void navigate({ to: '/app' }))}>
              Home
              <CommandShortcut>G H</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <CreateCompanyDialog open={createCompanyOpen} onOpenChange={setCreateCompanyOpen} />
      <CreateContactDialog open={createContactOpen} onOpenChange={setCreateContactOpen} />
      {defaultPipeline && (
        <CreateDealDialog
          pipeline={defaultPipeline}
          open={createDealOpen}
          onOpenChange={setCreateDealOpen}
        />
      )}
    </>
  );
}
