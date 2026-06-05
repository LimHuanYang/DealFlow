import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signup } from '@/lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'At least 12 characters'),
  name: z.string().min(1).max(120),
  orgName: z.string().min(1).max(120),
});

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute('/signup')({
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await signup(values);
      await router.navigate({ to: '/app' });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm">
            DF
          </span>
          <span className="text-lg font-semibold tracking-tight text-slate-900">DealFlow</span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Create your workspace
          </h1>
          <p className="mt-1 text-sm text-slate-500">Start managing your pipeline in minutes.</p>
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" autoComplete="name" {...register('name')} />
              {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="orgName">Organization name</Label>
              <Input id="orgName" autoComplete="organization" {...register('orgName')} />
              {errors.orgName && <p className="text-sm text-red-600">{errors.orgName.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email')} />
              {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
              />
              {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
            </div>
            {serverError && <p className="text-sm text-red-600">{serverError}</p>}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create account'}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <a className="font-medium text-primary hover:underline" href="/login">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
