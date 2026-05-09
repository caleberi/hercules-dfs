import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-[#12141D] px-6 py-10 text-white">
      <div className="mx-auto max-w-lg">
        <Button variant="ghost" className="mb-6 gap-2 text-slate-300" asChild>
          <Link to="/">
            <ArrowLeft className="size-4" />
            Back to library
          </Link>
        </Button>
        <Card className="border-white/10">
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>
              Preferences for the Hercules media vault demo. Streaming endpoints and
              upload chunking are unchanged.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-400">
            <p>
              API base defaults to{' '}
              <span className="font-mono text-slate-300">http://localhost:8089/api/v1</span>
              . Adjust in source if your gateway listens elsewhere.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
