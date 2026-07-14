import "server-only";

import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ParsedSyllabus, SyllabusIngestionRecord, SyllabusParsingStatus } from "@/types/syllabus";
// The parser is intentionally a dependency-free ESM module so it can be unit-tested without a Next runtime.
// @ts-expect-error TypeScript does not resolve declarations for local .mjs modules in this project.
import { parseSyllabusText } from "./syllabus-parser.mjs";

const STORAGE_BUCKET = "syllabus-files";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function toRecord(row: Record<string, unknown>): SyllabusIngestionRecord {
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    sourceName: typeof row.source_name === "string" ? row.source_name : null,
    originalFilename: typeof row.original_filename === "string" ? row.original_filename : null,
    storagePath: typeof row.storage_path === "string" ? row.storage_path : null,
    mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
    parsingStatus: row.parsing_status as SyllabusParsingStatus,
    parsingError: typeof row.parsing_error === "string" ? row.parsing_error : null,
    rawExtractedText: typeof row.raw_extracted_text === "string" ? row.raw_extracted_text : null,
    parsedData: row.parsed_data && typeof row.parsed_data === "object" ? row.parsed_data as Partial<ParsedSyllabus> : {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "syllabus.pdf";
}

export async function uploadSyllabusFile(courseId: string, file: File, uploaderId: string) {
  if (!courseId || !uploaderId) throw new Error("Course and uploader are required");
  if (file.type !== "application/pdf") throw new Error("Only PDF syllabi are supported");
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error("Syllabus PDF must be between 1 byte and 10 MB");

  const supabase = createSupabaseAdminClient();
  const storagePath = `${uploaderId}/${courseId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
  const uploadResult = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, await file.arrayBuffer(), {
    contentType: file.type,
    upsert: false,
  });
  if (uploadResult.error) throw new Error(`Syllabus file upload failed: ${uploadResult.error.message}`);

  const { data, error } = await supabase
    .from("syllabi")
    .insert({
      course_id: courseId,
      uploaded_by: uploaderId,
      source_name: file.name,
      original_filename: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      parsing_status: "pending",
      parsed_data: {},
    })
    .select("id,course_id,source_name,original_filename,storage_path,mime_type,parsing_status,parsing_error,raw_extracted_text,parsed_data,created_at,updated_at")
    .single();

  if (error) {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw new Error(`Syllabus metadata save failed: ${error.message}`);
  }

  return toRecord(data as Record<string, unknown>);
}

export async function listSyllabusIngestionRecords(courseId: string) {
  if (!courseId) return [];
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("syllabi")
    .select("id,course_id,source_name,original_filename,storage_path,mime_type,parsing_status,parsing_error,raw_extracted_text,parsed_data,created_at,updated_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Syllabus metadata read failed: ${error.message}`);
  return (data ?? []).map((row) => toRecord(row as Record<string, unknown>));
}

export async function updateSyllabusParsingResult(
  syllabusId: string,
  result: { status: SyllabusParsingStatus; rawExtractedText?: string | null; parsedData?: Partial<ParsedSyllabus>; error?: string | null },
) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("syllabi")
    .update({
      parsing_status: result.status,
      raw_extracted_text: result.rawExtractedText ?? null,
      parsed_data: result.parsedData ?? {},
      parsing_error: result.error ?? null,
    })
    .eq("id", syllabusId)
    .select("id,course_id,source_name,original_filename,storage_path,mime_type,parsing_status,parsing_error,raw_extracted_text,parsed_data,created_at,updated_at")
    .single();
  if (error) throw new Error(`Syllabus parsing result save failed: ${error.message}`);
  return toRecord(data as Record<string, unknown>);
}

export async function parseStoredSyllabus(syllabusId: string) {
  if (!syllabusId) throw new Error("Syllabus id is required");

  const supabase = createSupabaseAdminClient();
  const { data: source, error: sourceError } = await supabase
    .from("syllabi")
    .select("id,course_id,storage_path,parsing_status")
    .eq("id", syllabusId)
    .maybeSingle();

  if (sourceError) throw new Error("Syllabus source read failed: " + sourceError.message);
  if (!source?.storage_path) throw new Error("Syllabus storage path is missing");

  await updateSyllabusParsingResult(syllabusId, { status: "processing", parsedData: {} });

  let extractedText = "";
  let parsedData: ParsedSyllabus | undefined;
  try {
    const { data: file, error: downloadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(source.storage_path);
    if (downloadError) throw new Error("Syllabus file download failed: " + downloadError.message);

    const extracted = await pdfParse(await file.arrayBuffer());
    extractedText = extracted.text;
    parsedData = parseSyllabusText(extracted.text);
    if (!parsedData) throw new Error("Syllabus parser returned no data");
    const record = await updateSyllabusParsingResult(syllabusId, {
      status: "completed",
      rawExtractedText: extracted.text,
      parsedData,
    });

    await persistNormalizedSyllabusData(supabase, source.course_id, parsedData);
    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown syllabus parsing error";
    await updateSyllabusParsingResult(syllabusId, {
      status: "failed",
      rawExtractedText: extractedText || null,
      parsedData: parsedData ?? {},
      error: message,
    });
    throw new Error(message);
  }
}

async function persistNormalizedSyllabusData(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  courseId: string,
  parsedData: ParsedSyllabus,
) {
  if (parsedData.schedules.length > 0) {
    const { error } = await supabase.from("course_schedules").upsert(
      parsedData.schedules.map((schedule) => ({
        course_id: courseId,
        day_of_week: schedule.dayOfWeek,
        start_time: schedule.startTime,
        end_time: schedule.endTime,
        classroom: schedule.classroom,
      })),
      { onConflict: "course_id,day_of_week,start_time,end_time" },
    );
    if (error) throw new Error("Syllabus schedule normalization failed: " + error.message);
  }

  if (parsedData.assessments.length > 0) {
    const { error } = await supabase.from("course_assessments").delete().eq("course_id", courseId);
    if (error) throw new Error("Syllabus assessment cleanup failed: " + error.message);

    const { error: insertError } = await supabase.from("course_assessments").insert(
      parsedData.assessments.map((assessment) => ({
        course_id: courseId,
        assessment_type: assessment.type,
        title: assessment.title,
        weight_percent: assessment.weightPercent,
        description: assessment.description,
      })),
    );
    if (insertError) throw new Error("Syllabus assessment normalization failed: " + insertError.message);
  }
}
