'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import {
  ArrowLeft,
  Phone,
  Plus,
  Trash2,
  Loader2,
  CheckCircle,
  AlertCircle,
  Shield,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  getVerifiedPhones,
  sendVerificationCode,
  checkVerificationCode,
  deleteVerifiedPhone,
} from '@/lib/api/phone';
import { cn } from '@/lib/utils/cn';
import type { VerifiedPhone } from '@/types/api';

function formatPhoneNumber(phone: string): string {
  // Simple US formatting
  if (phone.startsWith('+1') && phone.length === 12) {
    return `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
  }
  return phone;
}

function VerifiedPhoneCard({
  phone,
  onDelete,
}: {
  phone: VerifiedPhone;
  onDelete: (id: string) => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove this phone number?')) return;
    setIsDeleting(true);
    try {
      await onDelete(phone.id);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-100 rounded-full">
            <CheckCircle className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <p className="font-medium">{formatPhoneNumber(phone.phone_number)}</p>
            <p className="text-xs text-gray-500">
              Verified on {new Date(phone.verified_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={isDeleting}
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          {isDeleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </Button>
      </div>
    </Card>
  );
}

function AddPhoneForm({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<'input' | 'verify'>('input');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await sendVerificationCode(phoneNumber);
      setStep('verify');
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await checkVerificationCode(phoneNumber, code);
      onSuccess();
      setStep('input');
      setPhoneNumber('');
      setCode('');
    } catch (err: any) {
      setError(err.message || 'Invalid verification code');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <h3 className="font-medium mb-4 flex items-center gap-2">
        <Plus className="w-4 h-4" />
        Add Phone Number
      </h3>

      {step === 'input' ? (
        <form onSubmit={handleSendCode} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1 (555) 123-4567"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              We'll send a verification code to this number
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              {error}
            </p>
          )}

          <Button type="submit" disabled={isLoading || !phoneNumber}>
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Phone className="w-4 h-4 mr-2" />
            )}
            Send Verification Code
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <p className="text-sm text-gray-600">
            We sent a verification code to{' '}
            <span className="font-medium">{phoneNumber}</span>
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Verification Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-center text-2xl tracking-widest"
              maxLength={6}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStep('input');
                setCode('');
                setError(null);
              }}
            >
              Back
            </Button>
            <Button type="submit" disabled={isLoading || code.length !== 6}>
              {isLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              Verify
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

export default function PhoneSettingsPage() {
  const { data, error, isLoading, mutate: refreshPhones } = useSWR(
    'verified-phones',
    getVerifiedPhones
  );

  const handleDeletePhone = async (id: string) => {
    try {
      await deleteVerifiedPhone(id);
      refreshPhones();
    } catch (err: any) {
      alert(err.message || 'Failed to delete phone number');
    }
  };

  const handleAddSuccess = () => {
    refreshPhones();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const phones = data?.phones || [];

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <Link
          href="/phone"
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Phone Calls
        </Link>
        <h1 className="text-2xl font-semibold">Phone Settings</h1>
        <p className="text-gray-500 mt-1">
          Manage your verified phone numbers for call recording
        </p>
      </div>

      {/* Info card */}
      <Card className="p-4 mb-6 bg-blue-50 border-blue-200">
        <div className="flex gap-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">About Phone Call Recording</p>
            <p>
              To record phone calls, you need to verify your phone number. Once verified,
              you can make calls through the Meeting Mind mobile app and record them for
              transcription and summarization.
            </p>
          </div>
        </div>
      </Card>

      {/* Verified phones */}
      <div className="mb-6">
        <h2 className="text-lg font-medium mb-3">Verified Numbers</h2>
        {phones.length === 0 ? (
          <Card className="p-8 flex flex-col items-center justify-center text-center">
            <Phone className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500">No verified phone numbers yet</p>
            <p className="text-sm text-gray-400 mt-1">
              Add a phone number below to get started
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {phones.map((phone) => (
              <VerifiedPhoneCard
                key={phone.id}
                phone={phone}
                onDelete={handleDeletePhone}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add phone form */}
      <AddPhoneForm onSuccess={handleAddSuccess} />
    </div>
  );
}
