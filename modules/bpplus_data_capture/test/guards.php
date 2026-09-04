<?php

/**
 * What the save-xml endpoint refuses.
 *
 *   php modules/bpplus_data_capture/test/guards.php
 *
 * save-xml is declared in no-auth-ajax-actions, because a survey respondent is
 * not logged in. So it can be reached by someone who is not authenticated and
 * whose page this module did not write, and the checks in front of it are the
 * only thing between a survey and an endpoint that writes files to a server.
 *
 * That is not something to reason about. This runs the shipped class against
 * stubs for the two things it touches outside itself -- the framework base
 * class and REDCap's file API -- so every guard is exercised as written.
 *
 * It cannot prove that REDCap accepts the file. That needs a real project.
 */

namespace ExternalModules {

/** Only the parts BpPlusDataCapture actually calls. */
abstract class AbstractExternalModule
{
    public array $settings = [];
    public array $logged = [];

    public function getProjectSetting($key)
    {
        return $this->settings[$key] ?? null;
    }

    public function log($message, $params = [])
    {
        $this->logged[] = ['message' => $message, 'params' => $params];
        return 1;
    }

    public function getUrl($path)
    {
        return 'https://example.invalid/' . $path;
    }

    public function initializeJavascriptModuleObject()
    {
        return '';
    }

    public function getJavascriptModuleObjectName()
    {
        return 'ExternalModules.Uscom.BpPlusDataCapture';
    }
}

}

namespace {

/** REDCap's file API, standing in. Records what it was asked to do. */
class REDCap
{
    public static array $stored = [];
    public static array $attached = [];
    public static int $nextDocId = 4200;
    public static bool $storeFails = false;
    public static bool $attachFails = false;

    public static function storeFile($path, $projectId, $name)
    {
        if (self::$storeFails) return 0;
        self::$stored[] = ['path' => $path, 'bytes' => filesize($path), 'name' => $name];
        return self::$nextDocId++;
    }

    public static function addFileToField($docId, $projectId, $record, $field, $eventId, $instance)
    {
        if (self::$attachFails) return false;
        self::$attached[] = compact('docId', 'record', 'field', 'instance');
        return true;
    }
}

require __DIR__ . '/../BpPlusDataCapture.php';

use Uscom\BpPlusDataCapture\BpPlusDataCapture;

$failures = 0;
$group = '';

function heading(string $name): void
{
    global $group;
    $group = $name;
    echo "\n$name\n";
}

function check(string $what, bool $ok, string $detail = ''): void
{
    global $failures;
    if (!$ok) $failures++;
    echo '  ' . ($ok ? 'PASS' : 'FAIL') . "  $what\n";
    if (!$ok && $detail !== '') echo "        $detail\n";
}

/** One call to the endpoint, with the module configured as given. */
function call($xml, array $settings = [], string $instrument = 'bpplus_measurement', $record = 'REC-1'): array
{
    $module = new BpPlusDataCapture();
    $module->settings = $settings + ['save-xml-file' => true];

    $reply = $module->redcap_module_ajax(
        'save-xml', ['xml' => $xml], 1, $record, $instrument,
        11, 2, null, null, null, null, null, null, null
    );

    return ['reply' => $reply, 'logged' => $module->logged];
}

/** A payload shaped the way a device result is, padded to a chosen size. */
function result(int $bytes = 0): string
{
    $head = '<?xml version="1.0" encoding="utf-8" ?>' . "\n" . '<BPplus version="5.0"><PatientID></PatientID>';
    $tail = '</BPplus>';
    $pad  = max(0, $bytes - strlen($head) - strlen($tail));
    return $head . str_repeat('0', $pad) . $tail;
}

// -- The action and the setting ----------------------------------------------

heading('the endpoint answers only for what it is for');

$out = call(result(1000), [], 'bpplus_measurement');
check('a well-formed recording is accepted', ($out['reply']['status'] ?? '') === 'saved',
    json_encode($out['reply']));

$module = new BpPlusDataCapture();
$module->settings = ['save-xml-file' => true];
$reply = $module->redcap_module_ajax('something-else', [], 1, 'REC-1', 'bpplus_measurement',
    11, 2, null, null, null, null, null, null, null);
check('an unknown action is refused', ($reply['status'] ?? '') === 'error');

$out = call(result(1000), ['save-xml-file' => false]);
check('file storage off is refused', ($out['reply']['status'] ?? '') === 'error');

// -- The instrument -----------------------------------------------------------
// The module only puts its JavaScript on the capture instrument, so a call
// naming another one did not come from a page this module wrote.

heading('a call from somewhere else is refused');

$out = call(result(1000), [], 'some_other_form');
check('another instrument is refused', ($out['reply']['status'] ?? '') === 'error');
check('and the refusal is logged with what was received',
    count($out['logged']) === 1 &&
    ($out['logged'][0]['params']['instrument'] ?? '') === 'some_other_form',
    json_encode($out['logged']));

$out = call(result(1000), ['capture-instrument' => 'my_own_form'], 'my_own_form');
check('a project that renamed the instrument still works',
    ($out['reply']['status'] ?? '') === 'saved');

// -- The payload ---------------------------------------------------------------

heading('the payload has to be a recording');

foreach ([
    'an array'            => ['xml' => 'nope'],
    'a number'            => 12345,
    'null'                => null,
] as $what => $value) {
    $out = call($value);
    check("$what is refused without a type error", ($out['reply']['status'] ?? '') === 'error');
}

$junk = 'GIF89a' . str_repeat('x', 500) . '<BPplus' . str_repeat('y', 500);
$out = call($junk);
check('a payload that merely contains "<BPplus" is refused',
    ($out['reply']['status'] ?? '') === 'error');

$out = call('<?xml version="1.0" ?><BPplus version="5.0">' . str_repeat('z', 200));
check('a document with no closing tag is refused',
    ($out['reply']['status'] ?? '') === 'error');

$out = call('<html><body><BPplus></BPplus></body></html>');
check('a document that does not start as one is refused',
    ($out['reply']['status'] ?? '') === 'error');

$out = call(' ' . "\n\t" . result(1000));
check('leading whitespace is tolerated', ($out['reply']['status'] ?? '') === 'saved');

// -- The size limit -------------------------------------------------------------
// An unauthenticated endpoint that writes files needs a bound, or it is
// somewhere to put anything at all.

heading('the size limit holds');

$out = call(result(2 * 1024 * 1024));
check('over the 1 MB default is refused', ($out['reply']['status'] ?? '') === 'error');
check('and says so plainly',
    ($out['reply']['message'] ?? '') === 'Recording exceeds the maximum supported size.',
    $out['reply']['message'] ?? '');
check('and the refusal is logged with the size',
    ($out['logged'][0]['params']['bytes'] ?? 0) > 1024 * 1024);

$out = call(result(900 * 1024));
check('a large but plausible AOBP result is accepted',
    ($out['reply']['status'] ?? '') === 'saved', json_encode($out['reply']['message'] ?? ''));

$out = call(result(300 * 1024), ['max-recording-mb' => '0.2']);
check('a project can lower the limit', ($out['reply']['status'] ?? '') === 'error');

$out = call(result(300 * 1024), ['max-recording-mb' => '4']);
check('and raise it', ($out['reply']['status'] ?? '') === 'saved');

// Clamped, not merely defaulted: 1000 where 10 was meant must not turn this
// into an endpoint with no bound at all.
$out = call(result(17 * 1024 * 1024), ['max-recording-mb' => '1000']);
check('an absurd setting is clamped rather than obeyed',
    ($out['reply']['status'] ?? '') === 'error');

$out = call(result(1000), ['max-recording-mb' => 'plenty']);
check('a nonsense setting falls back to the default',
    ($out['reply']['status'] ?? '') === 'saved');

// -- The record ------------------------------------------------------------------

heading('a file needs a record to go on');

$out = call(result(1000), [], 'bpplus_measurement', '');
check('no record is refused, and says the measurement is unaffected',
    ($out['reply']['status'] ?? '') === 'error' &&
    strpos($out['reply']['message'] ?? '', 'unaffected') !== false);

// -- What a success returns --------------------------------------------------------

heading('a stored recording reports what the page needs');

REDCap::$stored = [];
REDCap::$attached = [];
$xml = result(5000);
$out = call($xml);
$reply = $out['reply'];

check('the document id comes back', !empty($reply['doc_id']));
check('and the field name', ($reply['field'] ?? '') === 'bpplus_xml');
check('the byte count is the payload, not the file on disk',
    ($reply['bytes'] ?? 0) === strlen($xml));
check('the hash is of what was sent', ($reply['sha256'] ?? '') === hash('sha256', $xml));
check('the whole payload reached storeFile',
    (REDCap::$stored[0]['bytes'] ?? -1) === strlen($xml));

// The instance is not optional: an instrument that repeats would otherwise file
// every measurement against instance 1.
check('it is attached to the instance it came from',
    (string) (REDCap::$attached[0]['instance'] ?? '') === '2');

check('the temporary file is removed', count(glob(sys_get_temp_dir() . '/bpplus_*')) === 0,
    implode(', ', glob(sys_get_temp_dir() . '/bpplus_*')));

heading('a failure is reported rather than swallowed');

REDCap::$storeFails = true;
$out = call(result(1000));
check('storeFile returning nothing is an error', ($out['reply']['status'] ?? '') === 'error');
REDCap::$storeFails = false;

REDCap::$attachFails = true;
$out = call(result(1000));
check('a file that does not attach is an error', ($out['reply']['status'] ?? '') === 'error');
check('and the message names the field to check',
    strpos($out['reply']['message'] ?? '', 'bpplus_xml') !== false);
REDCap::$attachFails = false;

check('nothing was left in the temporary directory',
    count(glob(sys_get_temp_dir() . '/bpplus_*')) === 0);

echo $failures ? "\n$failures FAILED\n" : "\nall checks passed\n";
exit($failures ? 1 : 0);

}
