<?php

namespace Uscom\BpPlusDataCapture;

use ExternalModules\AbstractExternalModule;
use Exception;

/**
 * BP+ Data Capture.
 *
 * Puts the BP+ JavaScript SDK on a data-entry or survey page and tells it which
 * record it is filling. The device is on the operator's cable, not on the
 * server, so the whole measurement happens in the browser: nothing here touches
 * the wire protocol, and no part of a measurement passes through PHP unless the
 * raw XML is being stored as a file.
 *
 * This module is an example. It is deliberately small, and everything a study is
 * likely to want different — the instrument, the field names, whether the XML is
 * kept — is a project setting rather than an edit.
 *
 * @see README.md
 */
class BpPlusDataCapture extends AbstractExternalModule
{
    /** Used when the matching project setting is blank. */
    private const DEFAULT_INSTRUMENT = 'bpplus_measurement';
    private const DEFAULT_PREFIX     = 'bpplus_';
    private const DEFAULT_CLOCK_MINS = 5.0;

    /**
     * The suffix of the File Upload field the raw XML is stored in.
     *
     * Combined with the project's field prefix, so a project that renamed its
     * fields does not also have to rename this one.
     */
    private const XML_FIELD_SUFFIX = 'xml';

    // -- Hooks ---------------------------------------------------------------

    public function redcap_data_entry_form(
        $project_id,
        $record,
        $instrument,
        $event_id,
        $group_id,
        $repeat_instance
    ) {
        $this->emitFor($instrument, $project_id, $record, $event_id, $repeat_instance);
    }

    public function redcap_survey_page_top(
        $project_id,
        $record,
        $instrument,
        $event_id,
        $group_id,
        $survey_hash,
        $response_id,
        $repeat_instance
    ) {
        $this->emitFor($instrument, $project_id, $record, $event_id, $repeat_instance);
    }

    /**
     * Both entry points, so the same instrument works as a form and as a survey.
     *
     * Which one a study uses is not this module's business, and a module that
     * only worked on a survey would fail silently on the data-entry form that
     * every project has anyway.
     */
    private function emitFor($instrument, $project_id, $record, $event_id, $repeat_instance): void
    {
        if ($instrument !== $this->captureInstrument()) {
            return;
        }

        $this->emitConfig($project_id, $record, $event_id, $repeat_instance);

        // The framework's own JavaScript object, and the only supported way to
        // reach redcap_module_ajax() from a page. It carries the module prefix
        // and the survey's CSRF token, neither of which a bare POST has.
        //
        // There is no global `ExternalModules.ajax()`. A page that calls one
        // gets "ExternalModules is not defined" at the moment a measurement
        // finishes -- which is to say, on the first participant.
        echo $this->initializeJavascriptModuleObject();
        echo '<script>window.BPPLUS_MODULE = '
            . $this->getJavascriptModuleObjectName() . ';</script>' . "\n";

        $src = htmlspecialchars($this->getUrl('js/bpplus-capture.js'), ENT_QUOTES);
        echo '<script src="' . $src . '"></script>' . "\n";
    }

    /**
     * Hold one measurement's raw XML until the page save is over.
     *
     * Reached from the page with BPPLUS_MODULE.ajax('save-xml', payload). The
     * framework authenticates the call and supplies $project_id, so unlike a
     * bare POST endpoint this cannot be aimed at another project.
     *
     * It does NOT file the recording. Filing it here creates an edoc that the
     * next page submit destroys:
     *
     *   The file field is on the instrument being filled in. A submit saves
     *   every field on that page, and the file input is empty -- nobody chose a
     *   file, this module attached one behind it -- so REDCap writes that
     *   emptiness over the doc id. Clearing a file field is how REDCap deletes
     *   an edoc: it sets delete_date on the metadata row.
     *
     * Re-attaching the doc id after the save is not a way round it: the link
     * then points at a row REDCap considers deleted, and downloads as "Either
     * this file does not exist OR you do not have permission to download it."
     *
     * So the bytes wait on disk and redcap_save_record() files them once the
     * save is over. One edoc per recording, created after the only thing that
     * would destroy it.
     *
     * Off unless the project turns it on. The measurement itself does not depend
     * on it: by the time this runs the fields are already filled, so a failure
     * here is reported and let go rather than losing a reading already taken on
     * a participant who is still sitting there.
     */
    public function redcap_module_ajax(
        $action,
        $payload,
        $project_id,
        $record,
        $instrument,
        $event_id,
        $repeat_instance,
        $survey_hash,
        $response_id,
        $survey_queue_hash,
        $page,
        $page_full,
        $user_id,
        $group_id
    ) {
        if ($action !== 'save-xml') {
            return ['status' => 'error', 'message' => 'Unknown action.'];
        }

        if (!$this->getProjectSetting('save-xml-file')) {
            return ['status' => 'error', 'message' => 'Storing the XML as a file is not enabled for this project.'];
        }

        $xml = $payload['xml'] ?? '';

        // Cheap, and it is the whole check: this only ever receives what the
        // device produced, and anything else is a mistake worth naming rather
        // than a file worth keeping.
        if ($xml === '' || strpos($xml, '<BPplus') === false) {
            return ['status' => 'error', 'message' => 'That does not look like a BP+ measurement.'];
        }

        $field = $this->fieldPrefix() . self::XML_FIELD_SUFFIX;

        // A file cannot be attached to a record that does not exist. On a survey
        // the record is created when the first page is submitted, so a
        // measurement taken before that has nowhere to go. Said plainly, because
        // the page can offer to send it again once the record exists.
        if ((string) $record === '') {
            return [
                'status'  => 'error',
                'message' => 'This page has no record yet, so the recording cannot be '
                           . 'filed. Save the form, then press Resend recording.',
            ];
        }

        // Held, not filed. See the note above: filing now loses a race with the
        // page submit, which clears the empty file input over the doc id and
        // tombstones the edoc.
        $stash = $this->stashPath($project_id, $record, $event_id, $repeat_instance, $field);

        if (file_put_contents($stash, $xml) === false) {
            $this->log('BP+ recording could not be held', [
                'record' => $record, 'instance' => $repeat_instance, 'field' => $field,
            ]);
            return ['status' => 'error', 'message' => 'The server could not hold the recording.'];
        }

        $this->log('BP+ recording held for saving', [
            'record'   => $record,
            'instance' => $repeat_instance,
            'field'    => $field,
            'bytes'    => strlen($xml),
        ]);

        return [
            'status'   => 'held',
            'field'    => $field,
            'filename' => $this->recordingFilename($record, $repeat_instance),
            'bytes'    => strlen($xml),
            'sha256'   => hash('sha256', $xml),
        ];
    }

    /**
     * File every recording held for this record and instance.
     *
     * Runs after the submit, which is the whole point: the save that would have
     * destroyed the edoc has already happened, so the one created here survives
     * it.
     */
    public function redcap_save_record(
        $project_id,
        $record,
        $instrument,
        $event_id,
        $group_id,
        $survey_hash,
        $response_id,
        $repeat_instance
    ) {
        if ($instrument !== $this->captureInstrument()) {
            return;
        }

        $this->fileHeldRecording($project_id, $record, $event_id, $repeat_instance);
    }

    /**
     * Turn a held recording into an edoc on the record, if one is waiting.
     *
     * A failed attempt leaves the held file exactly where it is, so the next
     * save of this instance tries again. A recording is not thrown away because
     * one attempt failed -- by this point there is nothing left in the browser
     * to send again.
     */
    private function fileHeldRecording($project_id, $record, $event_id, $repeat_instance): void
    {
        $field = $this->fieldPrefix() . self::XML_FIELD_SUFFIX;
        $stash = $this->stashPath($project_id, $record, $event_id, $repeat_instance, $field);

        if (!is_file($stash)) {
            return;                       // nothing waiting for this instance
        }

        $filename = $this->recordingFilename($record, $repeat_instance);

        try {
            // Two calls, and both are required. storeFile() copies the bytes
            // into the edoc store and returns a doc id -- or 0 -- which gets the
            // file onto the server and nowhere near the record.
            // addFileToField() is what puts it on the record. The instance is
            // not optional: an instrument that repeats will otherwise file every
            // measurement against instance 1.
            //
            // Note the method names: storeFile() and addFileToField(). There is
            // no REDCap::saveFile(), however plausible it reads.
            $docId = REDCap::storeFile($stash, $project_id, $filename);
            if (!$docId) {
                throw new Exception('REDCap::storeFile did not store the file.');
            }

            $linked = REDCap::addFileToField(
                $docId, $project_id, $record, $field, $event_id, $repeat_instance
            );
            if (!$linked) {
                throw new Exception(
                    'Stored as doc ' . $docId . ' but addFileToField did not attach it to "'
                    . $field . '". Check that the field exists on the instrument and is a '
                    . 'File Upload field.'
                );
            }

            $this->log('BP+ recording stored', [
                'record'   => $record,
                'instance' => $repeat_instance,
                'field'    => $field,
                'doc_id'   => $docId,
                'bytes'    => (string) filesize($stash),
            ]);
        } catch (Exception $e) {
            $this->log('BP+ recording failed', [
                'record'   => $record,
                'instance' => $repeat_instance,
                'field'    => $field,
                'message'  => $e->getMessage(),
            ]);
            return;                       // left in place, so the next save retries
        }

        unlink($stash);
    }

    /** Where one recording waits between the measurement and the page save. */
    private function stashPath($project_id, $record, $event_id, $repeat_instance, $field): string
    {
        $dir = defined('APP_PATH_TEMP') && is_dir(APP_PATH_TEMP)
            ? rtrim(APP_PATH_TEMP, '/' . DIRECTORY_SEPARATOR)
            : sys_get_temp_dir();

        // Hashed, because a record id is whatever the project allows and this
        // becomes a path. Deterministic, because the save has to find it again
        // from a different request.
        $key = md5(implode('|', [$project_id, $record, $event_id, $repeat_instance ?: 1, $field]));

        return $dir . DIRECTORY_SEPARATOR . 'bpplus_pending_' . $key . '.xml';
    }

    /** Named so a directory of exported files still says which record and when. */
    private function recordingFilename($record, $repeat_instance): string
    {
        return $this->safeName((string) $record)
            . '_i' . ($repeat_instance ?: 1)
            . '_' . date('Ymd-His')
            . '_bpplus.xml';
    }

    // -- Settings ------------------------------------------------------------

    private function captureInstrument(): string
    {
        $configured = trim((string) $this->getProjectSetting('capture-instrument'));
        return $configured !== '' ? $configured : self::DEFAULT_INSTRUMENT;
    }

    /**
     * The prefix every field name is built from.
     *
     * A trailing underscore is added when it is missing, because "bpplus" and
     * "bpplus_" are the same intention and only one of them matches the fields
     * the supplied data dictionary creates.
     */
    private function fieldPrefix(): string
    {
        $configured = trim((string) $this->getProjectSetting('field-prefix'));
        if ($configured === '') {
            return self::DEFAULT_PREFIX;
        }

        $clean = preg_replace('/[^a-z0-9_]/', '', strtolower($configured));
        if ($clean === '') {
            return self::DEFAULT_PREFIX;
        }

        return substr($clean, -1) === '_' ? $clean : $clean . '_';
    }

    /**
     * How far the device clock may be out before it is set from the browser.
     *
     * The device timestamp is written into the result XML, so a clock that is
     * wrong mislabels data permanently. Blank or nonsense falls back to five
     * minutes rather than to no checking at all.
     */
    private function clockToleranceMinutes(): float
    {
        $configured = trim((string) $this->getProjectSetting('clock-tolerance-minutes'));
        if ($configured === '' || !is_numeric($configured) || (float) $configured < 0) {
            return self::DEFAULT_CLOCK_MINS;
        }
        return (float) $configured;
    }

    /** The MeasureMode the device must report, or null for "any". */
    private function requiredMode(): ?int
    {
        $configured = trim((string) $this->getProjectSetting('require-mode'));
        return $configured === '' ? null : (int) $configured;
    }

    // -- The page ------------------------------------------------------------

    /**
     * The values the page script needs.
     *
     * sdkUrl is passed explicitly because the script imports the SDK as an ES
     * module at run time. Resolving it here means the import works whatever this
     * installation does with static file URLs.
     */
    private function emitConfig($project_id, $record, $event_id, $repeat_instance): void
    {
        $config = [
            'record'          => (string) $record,
            'event_id'        => (string) $event_id,
            'repeat_instance' => (string) $repeat_instance,
            'pid'             => (string) $project_id,

            'sdkUrl'          => $this->getUrl('sdk/index.js'),
            'fieldPrefix'     => $this->fieldPrefix(),

            'saveXmlAsFile'         => (bool) $this->getProjectSetting('save-xml-file'),
            'clockToleranceMinutes' => $this->clockToleranceMinutes(),
            'requiredMode'          => $this->requiredMode(),
            'hostStartedOnly'       => (bool) $this->getProjectSetting('host-started-only'),
            'trace'                 => (bool) $this->getProjectSetting('trace'),
        ];

        // json_encode with the HEX_* flags escapes everything that could close
        // the script element, so no value reaching the page can end it early.
        $json = json_encode(
            $config,
            JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
        );

        echo '<script>window.BPPLUS_CONFIG = ' . $json . ';</script>' . "\n";
    }

    /** A record ID that is safe in a filename, whatever the project allows in one. */
    private function safeName(string $value): string
    {
        $safe = preg_replace('/[^A-Za-z0-9._-]/', '-', $value);
        return $safe === '' ? 'record' : substr($safe, 0, 64);
    }
}
