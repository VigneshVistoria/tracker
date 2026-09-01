import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { apiFetch, ApiError } from '../lib/api';
import { getUser, clearSession, StoredUser } from '../lib/auth';

interface AssignableUser {
  id: number;
  email: string;
  fullName: string | null;
}

export default function NewTicketScreen({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [me, setMe] = useState<StoredUser | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignees, setAssignees] = useState<AssignableUser[]>([]);
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedId, setSubmittedId] = useState<number | null>(null);

  useEffect(() => {
    getUser().then(setMe);
    apiFetch('/users/assignable')
      .then(setAssignees)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load assignees.'));
  }, []);

  const runOcr = async (uri: string) => {
    setOcrRunning(true);
    setError('');
    try {
      const result = await TextRecognition.recognize(uri);
      // Pre-fill, but this is a starting point, not a final answer - the
      // user reviews/edits it below before submitting. OCR on a phone
      // photo is never going to be perfect (lighting, angle, etc.).
      setDescription(result.text.trim());
    } catch (err: any) {
      setError('Could not read text from that photo - you can still type the description manually.');
    } finally {
      setOcrRunning(false);
    }
  };

  const pickFromCamera = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera permission needed', 'Enable camera access in Settings to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
        setPhotoBase64(result.assets[0].base64 ?? null);
        runOcr(result.assets[0].uri);
      }
    } catch (err) {
      // Logged (not just swallowed) so a real native-side failure shows up
      // in device/crash logs instead of only ever surfacing this generic
      // message.
      console.error('launchCameraAsync failed:', err);
      Alert.alert('Could not open camera', 'Try again, or choose an existing photo instead.');
    }
  };

  const pickFromLibrary = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo library permission needed', 'Enable photo access in Settings to choose a photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true });
      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
        setPhotoBase64(result.assets[0].base64 ?? null);
        runOcr(result.assets[0].uri);
      }
    } catch (err) {
      console.error('launchImageLibraryAsync failed:', err);
      Alert.alert('Could not open photo library', 'Try again, or take a new photo instead.');
    }
  };

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const issue = await apiFetch('/issues', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: description || undefined,
          assigneeUserId: assigneeId ?? undefined,
          photoBase64: photoBase64 ?? undefined,
        }),
      });
      setSubmittedId(issue.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setPhotoUri(null);
    setPhotoBase64(null);
    setTitle('');
    setDescription('');
    setAssigneeId(null);
    setSubmittedId(null);
  };

  const handleLogout = async () => {
    await clearSession();
    onLoggedOut();
  };

  if (submittedId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.successTitle}>Ticket #{submittedId} created</Text>
        <TouchableOpacity style={styles.button} onPress={resetForm}>
          <Text style={styles.buttonText}>File Another Ticket</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <View style={styles.header}>
        <Text style={styles.title}>New Ticket</Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logout}>Log out</Text>
        </TouchableOpacity>
      </View>
      {me ? <Text style={styles.subtitle}>Signed in as {me.fullName || me.email}</Text> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {photoUri ? (
        <Image source={{ uri: photoUri }} style={styles.preview} />
      ) : (
        <View style={styles.photoRow}>
          <TouchableOpacity style={styles.photoButton} onPress={pickFromCamera}>
            <Text style={styles.photoButtonText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoButton} onPress={pickFromLibrary}>
            <Text style={styles.photoButtonText}>Choose Existing</Text>
          </TouchableOpacity>
        </View>
      )}

      {photoUri && (
        <TouchableOpacity
          onPress={() => {
            setPhotoUri(null);
            setPhotoBase64(null);
          }}
        >
          <Text style={styles.retake}>Retake / choose a different photo</Text>
        </TouchableOpacity>
      )}

      {ocrRunning && (
        <View style={styles.ocrRow}>
          <ActivityIndicator />
          <Text style={styles.ocrText}>Reading text from photo...</Text>
        </View>
      )}

      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Short summary" />

      <Text style={styles.label}>Description {photoUri ? '(from photo - edit as needed)' : ''}</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={description}
        onChangeText={setDescription}
        placeholder="What's the issue?"
        multiline
      />

      <Text style={styles.label}>Assignee</Text>
      <View style={styles.assigneeList}>
        {assignees.map((a) => (
          <TouchableOpacity
            key={a.id}
            style={[styles.assigneeChip, assigneeId === a.id && styles.assigneeChipSelected]}
            onPress={() => setAssigneeId(a.id)}
          >
            <Text style={[styles.assigneeChipText, assigneeId === a.id && styles.assigneeChipTextSelected]}>
              {a.fullName || a.email}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.button, (!title || submitting) && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!title || submitting}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create Ticket</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 2, marginBottom: 16 },
  successTitle: { fontSize: 20, fontWeight: '700', marginBottom: 20, textAlign: 'center' },
  logout: { color: '#1d4ed8', fontSize: 14 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, fontSize: 15 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  photoRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  photoButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#1d4ed8',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  photoButtonText: { color: '#1d4ed8', fontWeight: '600' },
  preview: { width: '100%', height: 220, borderRadius: 8, marginTop: 12, backgroundColor: '#f3f4f6' },
  retake: { color: '#1d4ed8', textAlign: 'center', marginTop: 8 },
  ocrRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  ocrText: { color: '#6b7280' },
  assigneeList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  assigneeChip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  assigneeChipSelected: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  assigneeChipText: { color: '#374151', fontSize: 13 },
  assigneeChipTextSelected: { color: '#fff' },
  button: { backgroundColor: '#1d4ed8', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#dc2626', marginBottom: 12 },
});
