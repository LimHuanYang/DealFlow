import { createFileRoute } from '@tanstack/react-router';
import { CustomFieldsSettings } from '@/features/custom-fields/custom-fields-settings';

export const Route = createFileRoute('/app/settings/custom-fields')({
  component: CustomFieldsSettings,
});
