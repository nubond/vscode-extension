/**
 * dom-elements.ts
 * Tag→TS-element-type mapping, per-tag DOM member tables, per-tag HTML
 * attribute tables, and the global DOM Element member registry. Sourced from
 * lib.dom.d.ts; consolidated here so completion and hover documentation share
 * one source of truth (no parallel "remember to update both" maintenance).
 */

import type { MemberInfo, NamedDesc, DomMember } from '../types';

/**
 * Map an HTML tag name to its TypeScript HTMLElement interface type.
 */
export function getElementType(tagName: string): string {
    const tagTypeMap: Record<string, string> = {
        'a': 'HTMLAnchorElement', 'area': 'HTMLAreaElement',
        'audio': 'HTMLAudioElement', 'base': 'HTMLBaseElement',
        'blockquote': 'HTMLQuoteElement', 'body': 'HTMLBodyElement',
        'br': 'HTMLBRElement', 'button': 'HTMLButtonElement',
        'canvas': 'HTMLCanvasElement', 'caption': 'HTMLTableCaptionElement',
        'col': 'HTMLTableColElement', 'colgroup': 'HTMLTableColElement',
        'data': 'HTMLDataElement', 'datalist': 'HTMLDataListElement',
        'details': 'HTMLDetailsElement', 'dialog': 'HTMLDialogElement',
        'div': 'HTMLDivElement', 'dl': 'HTMLDListElement',
        'embed': 'HTMLEmbedElement', 'fieldset': 'HTMLFieldSetElement',
        'form': 'HTMLFormElement', 'h1': 'HTMLHeadingElement',
        'h2': 'HTMLHeadingElement', 'h3': 'HTMLHeadingElement',
        'h4': 'HTMLHeadingElement', 'h5': 'HTMLHeadingElement',
        'h6': 'HTMLHeadingElement', 'head': 'HTMLHeadElement',
        'hr': 'HTMLHRElement', 'html': 'HTMLHtmlElement',
        'iframe': 'HTMLIFrameElement', 'img': 'HTMLImageElement',
        'input': 'HTMLInputElement', 'label': 'HTMLLabelElement',
        'legend': 'HTMLLegendElement', 'li': 'HTMLLIElement',
        'link': 'HTMLLinkElement', 'map': 'HTMLMapElement',
        'meta': 'HTMLMetaElement', 'meter': 'HTMLMeterElement',
        'object': 'HTMLObjectElement', 'ol': 'HTMLOListElement',
        'optgroup': 'HTMLOptGroupElement', 'option': 'HTMLOptionElement',
        'output': 'HTMLOutputElement', 'p': 'HTMLParagraphElement',
        'picture': 'HTMLPictureElement', 'pre': 'HTMLPreElement',
        'progress': 'HTMLProgressElement', 'q': 'HTMLQuoteElement',
        'script': 'HTMLScriptElement', 'select': 'HTMLSelectElement',
        'slot': 'HTMLSlotElement', 'source': 'HTMLSourceElement',
        'span': 'HTMLSpanElement', 'style': 'HTMLStyleElement',
        'table': 'HTMLTableElement', 'tbody': 'HTMLTableSectionElement',
        'td': 'HTMLTableCellElement', 'template': 'HTMLTemplateElement',
        'textarea': 'HTMLTextAreaElement', 'tfoot': 'HTMLTableSectionElement',
        'th': 'HTMLTableCellElement', 'thead': 'HTMLTableSectionElement',
        'time': 'HTMLTimeElement', 'title': 'HTMLTitleElement',
        'tr': 'HTMLTableRowElement', 'track': 'HTMLTrackElement',
        'ul': 'HTMLUListElement', 'video': 'HTMLVideoElement',
    };
    return tagTypeMap[tagName.toLowerCase()] || 'HTMLElement';
}

/**
 * Get tag-specific DOM members based on the HTMLElement type.
 * Returns additional members beyond the base Element interface.
 */
export function getTagSpecificMembers(elementType: string): DomMember[] {
    const mediaMembers: DomMember[] = [
        // HTMLMediaElement properties
        { name: 'src', kind: 'property', type: 'string', desc: 'URL of the media resource' },
        { name: 'currentSrc', kind: 'property', type: 'string', desc: 'URL of the current media resource' },
        { name: 'currentTime', kind: 'property', type: 'number', desc: 'Current playback position in seconds' },
        { name: 'duration', kind: 'property', type: 'number', desc: 'Length of the media in seconds' },
        { name: 'paused', kind: 'property', type: 'boolean', desc: 'Whether playback is paused' },
        { name: 'ended', kind: 'property', type: 'boolean', desc: 'Whether playback has finished' },
        { name: 'volume', kind: 'property', type: 'number', desc: 'Volume level (0.0 to 1.0)' },
        { name: 'muted', kind: 'property', type: 'boolean', desc: 'Whether audio is muted' },
        { name: 'playbackRate', kind: 'property', type: 'number', desc: 'Playback speed (1.0 = normal)' },
        { name: 'loop', kind: 'property', type: 'boolean', desc: 'Whether to loop playback' },
        { name: 'autoplay', kind: 'property', type: 'boolean', desc: 'Whether to auto-start playback' },
        { name: 'controls', kind: 'property', type: 'boolean', desc: 'Whether to show playback controls' },
        { name: 'readyState', kind: 'property', type: 'number', desc: 'Readiness state of the media' },
        { name: 'networkState', kind: 'property', type: 'number', desc: 'Network state of the media' },
        { name: 'buffered', kind: 'property', type: 'TimeRanges', desc: 'Buffered time ranges' },
        { name: 'preload', kind: 'property', type: 'string', desc: 'Preload hint (none, metadata, auto)' },
        // HTMLMediaElement methods
        { name: 'play', kind: 'method', type: '() => Promise<void>', desc: 'Start or resume playback' },
        { name: 'pause', kind: 'method', type: '() => void', desc: 'Pause playback' },
        { name: 'load', kind: 'method', type: '() => void', desc: 'Reload the media resource' },
        { name: 'canPlayType', kind: 'method', type: '(type: string) => string', desc: 'Check if media type is supported' },
        { name: 'fastSeek', kind: 'method', type: '(time: number) => void', desc: 'Seek to a time quickly' },
    ];

    const videoMembers: DomMember[] = [
        { name: 'width', kind: 'property', type: 'number', desc: 'Width of the video element' },
        { name: 'height', kind: 'property', type: 'number', desc: 'Height of the video element' },
        { name: 'videoWidth', kind: 'property', type: 'number', desc: 'Intrinsic width of the video' },
        { name: 'videoHeight', kind: 'property', type: 'number', desc: 'Intrinsic height of the video' },
        { name: 'poster', kind: 'property', type: 'string', desc: 'URL of the poster image' },
        { name: 'playsInline', kind: 'property', type: 'boolean', desc: 'Whether to play inline on mobile' },
        { name: 'getVideoPlaybackQuality', kind: 'method', type: '() => VideoPlaybackQuality', desc: 'Get video playback quality info' },
        { name: 'requestPictureInPicture', kind: 'method', type: '() => Promise<PictureInPictureWindow>', desc: 'Enter picture-in-picture mode' },
    ];

    const inputMembers: DomMember[] = [
        { name: 'value', kind: 'property', type: 'string', desc: 'Current value of the input' },
        { name: 'type', kind: 'property', type: 'string', desc: 'Type of the input (text, number, etc.)' },
        { name: 'name', kind: 'property', type: 'string', desc: 'Name of the input' },
        { name: 'placeholder', kind: 'property', type: 'string', desc: 'Placeholder text' },
        { name: 'disabled', kind: 'property', type: 'boolean', desc: 'Whether the input is disabled' },
        { name: 'readOnly', kind: 'property', type: 'boolean', desc: 'Whether the input is read-only' },
        { name: 'required', kind: 'property', type: 'boolean', desc: 'Whether the input is required' },
        { name: 'checked', kind: 'property', type: 'boolean', desc: 'Whether checkbox/radio is checked' },
        { name: 'min', kind: 'property', type: 'string', desc: 'Minimum value' },
        { name: 'max', kind: 'property', type: 'string', desc: 'Maximum value' },
        { name: 'step', kind: 'property', type: 'string', desc: 'Step increment' },
        { name: 'pattern', kind: 'property', type: 'string', desc: 'Validation pattern' },
        { name: 'selectionStart', kind: 'property', type: 'number | null', desc: 'Start of text selection' },
        { name: 'selectionEnd', kind: 'property', type: 'number | null', desc: 'End of text selection' },
        { name: 'validity', kind: 'property', type: 'ValidityState', desc: 'Validity state' },
        { name: 'select', kind: 'method', type: '() => void', desc: 'Select all text' },
        { name: 'setSelectionRange', kind: 'method', type: '(start: number, end: number) => void', desc: 'Set text selection range' },
        { name: 'checkValidity', kind: 'method', type: '() => boolean', desc: 'Check if the input is valid' },
        { name: 'reportValidity', kind: 'method', type: '() => boolean', desc: 'Report validity state' },
    ];

    const selectMembers: DomMember[] = [
        { name: 'value', kind: 'property', type: 'string', desc: 'Value of the selected option' },
        { name: 'selectedIndex', kind: 'property', type: 'number', desc: 'Index of the selected option' },
        { name: 'options', kind: 'property', type: 'HTMLOptionsCollection', desc: 'Collection of option elements' },
        { name: 'multiple', kind: 'property', type: 'boolean', desc: 'Whether multiple selection is allowed' },
        { name: 'disabled', kind: 'property', type: 'boolean', desc: 'Whether the select is disabled' },
        { name: 'name', kind: 'property', type: 'string', desc: 'Name of the select' },
        { name: 'required', kind: 'property', type: 'boolean', desc: 'Whether the select is required' },
        { name: 'length', kind: 'property', type: 'number', desc: 'Number of options' },
    ];

    const textareaMembers: DomMember[] = [
        { name: 'value', kind: 'property', type: 'string', desc: 'Current value of the textarea' },
        { name: 'name', kind: 'property', type: 'string', desc: 'Name of the textarea' },
        { name: 'placeholder', kind: 'property', type: 'string', desc: 'Placeholder text' },
        { name: 'disabled', kind: 'property', type: 'boolean', desc: 'Whether the textarea is disabled' },
        { name: 'readOnly', kind: 'property', type: 'boolean', desc: 'Whether the textarea is read-only' },
        { name: 'required', kind: 'property', type: 'boolean', desc: 'Whether the textarea is required' },
        { name: 'rows', kind: 'property', type: 'number', desc: 'Number of visible text rows' },
        { name: 'cols', kind: 'property', type: 'number', desc: 'Number of visible text columns' },
        { name: 'selectionStart', kind: 'property', type: 'number | null', desc: 'Start of text selection' },
        { name: 'selectionEnd', kind: 'property', type: 'number | null', desc: 'End of text selection' },
        { name: 'select', kind: 'method', type: '() => void', desc: 'Select all text' },
    ];

    const canvasMembers: DomMember[] = [
        { name: 'width', kind: 'property', type: 'number', desc: 'Width of the canvas' },
        { name: 'height', kind: 'property', type: 'number', desc: 'Height of the canvas' },
        { name: 'getContext', kind: 'method', type: '(contextId: string) => RenderingContext | null', desc: 'Get rendering context (2d, webgl, etc.)' },
        { name: 'toDataURL', kind: 'method', type: '(type?: string, quality?: number) => string', desc: 'Export canvas as data URL' },
        { name: 'toBlob', kind: 'method', type: '(callback: (blob: Blob | null) => void, type?: string, quality?: number) => void', desc: 'Export canvas as Blob' },
    ];

    const anchorMembers: DomMember[] = [
        { name: 'href', kind: 'property', type: 'string', desc: 'URL of the link' },
        { name: 'target', kind: 'property', type: 'string', desc: 'Target frame/window' },
        { name: 'rel', kind: 'property', type: 'string', desc: 'Relationship of linked resource' },
        { name: 'download', kind: 'property', type: 'string', desc: 'Download filename' },
        { name: 'hostname', kind: 'property', type: 'string', desc: 'Hostname of the URL' },
        { name: 'pathname', kind: 'property', type: 'string', desc: 'Path of the URL' },
        { name: 'hash', kind: 'property', type: 'string', desc: 'Hash fragment of the URL' },
        { name: 'search', kind: 'property', type: 'string', desc: 'Query string of the URL' },
    ];

    const imgMembers: DomMember[] = [
        { name: 'src', kind: 'property', type: 'string', desc: 'URL of the image' },
        { name: 'alt', kind: 'property', type: 'string', desc: 'Alternative text' },
        { name: 'width', kind: 'property', type: 'number', desc: 'Width of the image element' },
        { name: 'height', kind: 'property', type: 'number', desc: 'Height of the image element' },
        { name: 'naturalWidth', kind: 'property', type: 'number', desc: 'Intrinsic width of the image' },
        { name: 'naturalHeight', kind: 'property', type: 'number', desc: 'Intrinsic height of the image' },
        { name: 'complete', kind: 'property', type: 'boolean', desc: 'Whether the image has finished loading' },
        { name: 'loading', kind: 'property', type: 'string', desc: 'Loading strategy (lazy, eager)' },
        { name: 'decode', kind: 'method', type: '() => Promise<void>', desc: 'Decode image for rendering' },
    ];

    const formMembers: DomMember[] = [
        { name: 'action', kind: 'property', type: 'string', desc: 'URL for form submission' },
        { name: 'method', kind: 'property', type: 'string', desc: 'HTTP method (GET, POST)' },
        { name: 'elements', kind: 'property', type: 'HTMLFormControlsCollection', desc: 'Form control elements' },
        { name: 'length', kind: 'property', type: 'number', desc: 'Number of form controls' },
        { name: 'submit', kind: 'method', type: '() => void', desc: 'Submit the form' },
        { name: 'reset', kind: 'method', type: '() => void', desc: 'Reset the form' },
        { name: 'checkValidity', kind: 'method', type: '() => boolean', desc: 'Check if the form is valid' },
        { name: 'reportValidity', kind: 'method', type: '() => boolean', desc: 'Report form validity' },
        { name: 'requestSubmit', kind: 'method', type: '(submitter?: HTMLElement) => void', desc: 'Request form submission with validation' },
    ];

    const dialogMembers: DomMember[] = [
        { name: 'open', kind: 'property', type: 'boolean', desc: 'Whether the dialog is open' },
        { name: 'returnValue', kind: 'property', type: 'string', desc: 'Return value of the dialog' },
        { name: 'show', kind: 'method', type: '() => void', desc: 'Show the dialog (non-modal)' },
        { name: 'showModal', kind: 'method', type: '() => void', desc: 'Show the dialog as modal' },
        { name: 'close', kind: 'method', type: '(returnValue?: string) => void', desc: 'Close the dialog' },
    ];

    const buttonMembers: DomMember[] = [
        { name: 'disabled', kind: 'property', type: 'boolean', desc: 'Whether the button is disabled' },
        { name: 'name', kind: 'property', type: 'string', desc: 'Name of the button' },
        { name: 'type', kind: 'property', type: 'string', desc: 'Type of the button (submit, reset, button)' },
        { name: 'value', kind: 'property', type: 'string', desc: 'Value of the button' },
        { name: 'form', kind: 'property', type: 'HTMLFormElement | null', desc: 'Associated form element' },
        { name: 'formAction', kind: 'property', type: 'string', desc: 'Override form action URL' },
        { name: 'formMethod', kind: 'property', type: 'string', desc: 'Override form method' },
        { name: 'validity', kind: 'property', type: 'ValidityState', desc: 'Validity state' },
        { name: 'checkValidity', kind: 'method', type: '() => boolean', desc: 'Check if the button is valid' },
        { name: 'reportValidity', kind: 'method', type: '() => boolean', desc: 'Report validity state' },
    ];

    const iframeMembers: DomMember[] = [
        { name: 'src', kind: 'property', type: 'string', desc: 'URL of the iframe page' },
        { name: 'srcdoc', kind: 'property', type: 'string', desc: 'HTML content of the iframe' },
        { name: 'name', kind: 'property', type: 'string', desc: 'Name of the iframe' },
        { name: 'sandbox', kind: 'property', type: 'DOMTokenList', desc: 'Sandbox restrictions' },
        { name: 'allow', kind: 'property', type: 'string', desc: 'Feature policy for the iframe' },
        { name: 'width', kind: 'property', type: 'string', desc: 'Width of the iframe' },
        { name: 'height', kind: 'property', type: 'string', desc: 'Height of the iframe' },
        { name: 'contentDocument', kind: 'property', type: 'Document | null', desc: 'Document inside the iframe' },
        { name: 'contentWindow', kind: 'property', type: 'WindowProxy | null', desc: 'Window inside the iframe' },
        { name: 'loading', kind: 'property', type: 'string', desc: 'Loading strategy (lazy, eager)' },
    ];

    const detailsMembers: DomMember[] = [
        { name: 'open', kind: 'property', type: 'boolean', desc: 'Whether the details are expanded' },
    ];

    const meterMembers: DomMember[] = [
        { name: 'value', kind: 'property', type: 'number', desc: 'Current value' },
        { name: 'min', kind: 'property', type: 'number', desc: 'Minimum value' },
        { name: 'max', kind: 'property', type: 'number', desc: 'Maximum value' },
        { name: 'low', kind: 'property', type: 'number', desc: 'Low threshold' },
        { name: 'high', kind: 'property', type: 'number', desc: 'High threshold' },
        { name: 'optimum', kind: 'property', type: 'number', desc: 'Optimum value' },
    ];

    const progressMembers: DomMember[] = [
        { name: 'value', kind: 'property', type: 'number', desc: 'Current progress value' },
        { name: 'max', kind: 'property', type: 'number', desc: 'Maximum value' },
        { name: 'position', kind: 'property', type: 'number', desc: 'Current position (-1 if indeterminate)' },
    ];

    const slotMembers: DomMember[] = [
        { name: 'name', kind: 'property', type: 'string', desc: 'Name of the slot' },
        { name: 'assignedNodes', kind: 'method', type: '(options?: AssignedNodesOptions) => Node[]', desc: 'Get nodes assigned to this slot' },
        { name: 'assignedElements', kind: 'method', type: '(options?: AssignedNodesOptions) => Element[]', desc: 'Get elements assigned to this slot' },
    ];

    const tableMembers: DomMember[] = [
        { name: 'caption', kind: 'property', type: 'HTMLTableCaptionElement | null', desc: 'Table caption element' },
        { name: 'tHead', kind: 'property', type: 'HTMLTableSectionElement | null', desc: 'Table head section' },
        { name: 'tFoot', kind: 'property', type: 'HTMLTableSectionElement | null', desc: 'Table foot section' },
        { name: 'tBodies', kind: 'property', type: 'HTMLCollectionOf<HTMLTableSectionElement>', desc: 'Table body sections' },
        { name: 'rows', kind: 'property', type: 'HTMLCollectionOf<HTMLTableRowElement>', desc: 'All rows in the table' },
        { name: 'createCaption', kind: 'method', type: '() => HTMLTableCaptionElement', desc: 'Create or return caption' },
        { name: 'deleteCaption', kind: 'method', type: '() => void', desc: 'Delete the caption' },
        { name: 'createTHead', kind: 'method', type: '() => HTMLTableSectionElement', desc: 'Create or return thead' },
        { name: 'deleteTHead', kind: 'method', type: '() => void', desc: 'Delete the thead' },
        { name: 'createTFoot', kind: 'method', type: '() => HTMLTableSectionElement', desc: 'Create or return tfoot' },
        { name: 'deleteTFoot', kind: 'method', type: '() => void', desc: 'Delete the tfoot' },
        { name: 'insertRow', kind: 'method', type: '(index?: number) => HTMLTableRowElement', desc: 'Insert a new row' },
        { name: 'deleteRow', kind: 'method', type: '(index: number) => void', desc: 'Delete a row' },
    ];

    const tableRowMembers: DomMember[] = [
        { name: 'rowIndex', kind: 'property', type: 'number', desc: 'Row index in the table' },
        { name: 'sectionRowIndex', kind: 'property', type: 'number', desc: 'Row index in the section' },
        { name: 'cells', kind: 'property', type: 'HTMLCollectionOf<HTMLTableCellElement>', desc: 'Cells in this row' },
        { name: 'insertCell', kind: 'method', type: '(index?: number) => HTMLTableCellElement', desc: 'Insert a new cell' },
        { name: 'deleteCell', kind: 'method', type: '(index: number) => void', desc: 'Delete a cell' },
    ];

    const tableSectionMembers: DomMember[] = [
        { name: 'rows', kind: 'property', type: 'HTMLCollectionOf<HTMLTableRowElement>', desc: 'Rows in this section' },
        { name: 'insertRow', kind: 'method', type: '(index?: number) => HTMLTableRowElement', desc: 'Insert a new row' },
        { name: 'deleteRow', kind: 'method', type: '(index: number) => void', desc: 'Delete a row' },
    ];

    const tableCellMembers: DomMember[] = [
        { name: 'cellIndex', kind: 'property', type: 'number', desc: 'Cell index in the row' },
        { name: 'colSpan', kind: 'property', type: 'number', desc: 'Number of columns to span' },
        { name: 'rowSpan', kind: 'property', type: 'number', desc: 'Number of rows to span' },
        { name: 'headers', kind: 'property', type: 'string', desc: 'IDs of related header cells' },
    ];

    const optionMembers: DomMember[] = [
        { name: 'value', kind: 'property', type: 'string', desc: 'Value of the option' },
        { name: 'text', kind: 'property', type: 'string', desc: 'Text content of the option' },
        { name: 'label', kind: 'property', type: 'string', desc: 'Label of the option' },
        { name: 'selected', kind: 'property', type: 'boolean', desc: 'Whether the option is selected' },
        { name: 'disabled', kind: 'property', type: 'boolean', desc: 'Whether the option is disabled' },
        { name: 'index', kind: 'property', type: 'number', desc: 'Index within the select options' },
        { name: 'defaultSelected', kind: 'property', type: 'boolean', desc: 'Whether selected by default' },
        { name: 'form', kind: 'property', type: 'HTMLFormElement | null', desc: 'Associated form element' },
    ];

    const fieldsetMembers: DomMember[] = [
        { name: 'disabled', kind: 'property', type: 'boolean', desc: 'Whether the fieldset is disabled' },
        { name: 'name', kind: 'property', type: 'string', desc: 'Name of the fieldset' },
        { name: 'form', kind: 'property', type: 'HTMLFormElement | null', desc: 'Associated form element' },
        { name: 'elements', kind: 'property', type: 'HTMLFormControlsCollection', desc: 'Form controls in the fieldset' },
        { name: 'validity', kind: 'property', type: 'ValidityState', desc: 'Validity state' },
        { name: 'checkValidity', kind: 'method', type: '() => boolean', desc: 'Check if the fieldset is valid' },
    ];

    const outputMembers: DomMember[] = [
        { name: 'value', kind: 'property', type: 'string', desc: 'Current value of the output' },
        { name: 'defaultValue', kind: 'property', type: 'string', desc: 'Default value of the output' },
        { name: 'name', kind: 'property', type: 'string', desc: 'Name of the output' },
        { name: 'htmlFor', kind: 'property', type: 'DOMTokenList', desc: 'IDs of related form controls' },
        { name: 'form', kind: 'property', type: 'HTMLFormElement | null', desc: 'Associated form element' },
        { name: 'validity', kind: 'property', type: 'ValidityState', desc: 'Validity state' },
    ];

    const labelMembers: DomMember[] = [
        { name: 'htmlFor', kind: 'property', type: 'string', desc: 'ID of the associated form control' },
        { name: 'control', kind: 'property', type: 'HTMLElement | null', desc: 'Associated form control element' },
        { name: 'form', kind: 'property', type: 'HTMLFormElement | null', desc: 'Associated form element' },
    ];

    const objectMembers: DomMember[] = [
        { name: 'data', kind: 'property', type: 'string', desc: 'URL of the resource' },
        { name: 'type', kind: 'property', type: 'string', desc: 'MIME type of the resource' },
        { name: 'name', kind: 'property', type: 'string', desc: 'Name of the object' },
        { name: 'width', kind: 'property', type: 'string', desc: 'Width of the object' },
        { name: 'height', kind: 'property', type: 'string', desc: 'Height of the object' },
        { name: 'contentDocument', kind: 'property', type: 'Document | null', desc: 'Document inside the object' },
        { name: 'contentWindow', kind: 'property', type: 'WindowProxy | null', desc: 'Window inside the object' },
    ];

    const embedMembers: DomMember[] = [
        { name: 'src', kind: 'property', type: 'string', desc: 'URL of the embedded resource' },
        { name: 'type', kind: 'property', type: 'string', desc: 'MIME type of the resource' },
        { name: 'width', kind: 'property', type: 'string', desc: 'Width of the embed' },
        { name: 'height', kind: 'property', type: 'string', desc: 'Height of the embed' },
    ];

    const optgroupMembers: DomMember[] = [
        { name: 'disabled', kind: 'property', type: 'boolean', desc: 'Whether the option group is disabled' },
        { name: 'label', kind: 'property', type: 'string', desc: 'Label of the option group' },
    ];

    const olMembers: DomMember[] = [
        { name: 'start', kind: 'property', type: 'number', desc: 'Starting number of the list' },
        { name: 'reversed', kind: 'property', type: 'boolean', desc: 'Whether the list is reversed' },
        { name: 'type', kind: 'property', type: 'string', desc: 'Numbering type (1, a, A, i, I)' },
    ];

    const liMembers: DomMember[] = [
        { name: 'value', kind: 'property', type: 'number', desc: 'Value of the list item' },
    ];

    const trackMembers: DomMember[] = [
        { name: 'kind', kind: 'property', type: 'string', desc: 'Kind of text track (subtitles, captions, etc.)' },
        { name: 'src', kind: 'property', type: 'string', desc: 'URL of the track file' },
        { name: 'srclang', kind: 'property', type: 'string', desc: 'Language of the track' },
        { name: 'label', kind: 'property', type: 'string', desc: 'Label of the track' },
        { name: 'default', kind: 'property', type: 'boolean', desc: 'Whether this is the default track' },
        { name: 'readyState', kind: 'property', type: 'number', desc: 'Ready state of the track' },
        { name: 'track', kind: 'property', type: 'TextTrack', desc: 'The underlying TextTrack' },
    ];

    const sourceMembers: DomMember[] = [
        { name: 'src', kind: 'property', type: 'string', desc: 'URL of the media resource' },
        { name: 'type', kind: 'property', type: 'string', desc: 'MIME type of the resource' },
        { name: 'srcset', kind: 'property', type: 'string', desc: 'Responsive image source set' },
        { name: 'sizes', kind: 'property', type: 'string', desc: 'Image sizes for responsive images' },
        { name: 'media', kind: 'property', type: 'string', desc: 'Media query for the source' },
    ];

    const linkMembers: DomMember[] = [
        { name: 'href', kind: 'property', type: 'string', desc: 'URL of the linked resource' },
        { name: 'rel', kind: 'property', type: 'string', desc: 'Relationship of the linked resource' },
        { name: 'type', kind: 'property', type: 'string', desc: 'MIME type of the linked resource' },
        { name: 'media', kind: 'property', type: 'string', desc: 'Media query for the link' },
        { name: 'disabled', kind: 'property', type: 'boolean', desc: 'Whether the link is disabled' },
        { name: 'sheet', kind: 'property', type: 'CSSStyleSheet | null', desc: 'Associated style sheet' },
    ];

    const dataMembers: DomMember[] = [
        { name: 'value', kind: 'property', type: 'string', desc: 'Machine-readable value' },
    ];

    const timeMembers: DomMember[] = [
        { name: 'dateTime', kind: 'property', type: 'string', desc: 'Machine-readable date/time value' },
    ];

    const quoteMembers: DomMember[] = [
        { name: 'cite', kind: 'property', type: 'string', desc: 'URL of the quote source' },
    ];

    switch (elementType) {
        case 'HTMLVideoElement':
            return [...mediaMembers, ...videoMembers];
        case 'HTMLAudioElement':
            return mediaMembers;
        case 'HTMLInputElement':
            return inputMembers;
        case 'HTMLSelectElement':
            return selectMembers;
        case 'HTMLTextAreaElement':
            return textareaMembers;
        case 'HTMLCanvasElement':
            return canvasMembers;
        case 'HTMLAnchorElement':
            return anchorMembers;
        case 'HTMLImageElement':
            return imgMembers;
        case 'HTMLFormElement':
            return formMembers;
        case 'HTMLDialogElement':
            return dialogMembers;
        case 'HTMLButtonElement':
            return buttonMembers;
        case 'HTMLIFrameElement':
            return iframeMembers;
        case 'HTMLDetailsElement':
            return detailsMembers;
        case 'HTMLMeterElement':
            return meterMembers;
        case 'HTMLProgressElement':
            return progressMembers;
        case 'HTMLSlotElement':
            return slotMembers;
        case 'HTMLTableElement':
            return tableMembers;
        case 'HTMLTableRowElement':
            return tableRowMembers;
        case 'HTMLTableSectionElement':
            return tableSectionMembers;
        case 'HTMLTableCellElement':
            return tableCellMembers;
        case 'HTMLOptionElement':
            return optionMembers;
        case 'HTMLFieldSetElement':
            return fieldsetMembers;
        case 'HTMLOutputElement':
            return outputMembers;
        case 'HTMLLabelElement':
            return labelMembers;
        case 'HTMLObjectElement':
            return objectMembers;
        case 'HTMLEmbedElement':
            return embedMembers;
        case 'HTMLOptGroupElement':
            return optgroupMembers;
        case 'HTMLOListElement':
            return olMembers;
        case 'HTMLLIElement':
            return liMembers;
        case 'HTMLTrackElement':
            return trackMembers;
        case 'HTMLSourceElement':
            return sourceMembers;
        case 'HTMLLinkElement':
            return linkMembers;
        case 'HTMLDataElement':
            return dataMembers;
        case 'HTMLTimeElement':
            return timeMembers;
        case 'HTMLQuoteElement':
            return quoteMembers;
        default:
            return [];
    }
}

/** Global HTML attributes applicable to all elements */
const GLOBAL_HTML_ATTRIBUTES: NamedDesc[] = [
    { name: 'id', desc: 'Unique identifier for the element' },
    { name: 'class', desc: 'Space-separated list of CSS classes' },
    { name: 'style', desc: 'Inline CSS styles' },
    { name: 'title', desc: 'Advisory text (tooltip) for the element' },
    { name: 'lang', desc: 'Language of the element content' },
    { name: 'dir', desc: 'Text directionality (ltr, rtl, auto)' },
    { name: 'tabindex', desc: 'Tab order of the element' },
    { name: 'hidden', desc: 'Whether the element is hidden' },
    { name: 'draggable', desc: 'Whether the element is draggable' },
    { name: 'contenteditable', desc: 'Whether the content is editable' },
    { name: 'accesskey', desc: 'Keyboard shortcut to activate the element' },
    { name: 'role', desc: 'ARIA role for accessibility' },
    { name: 'slot', desc: 'Shadow DOM slot assignment' },
    { name: 'is', desc: 'Custom element extension (customized built-in)' },
    { name: 'aria-label', desc: 'Accessible label for the element' },
    { name: 'aria-hidden', desc: 'Whether the element is hidden from accessibility tree' },
    { name: 'aria-disabled', desc: 'Whether the element is disabled (ARIA)' },
    { name: 'aria-expanded', desc: 'Whether a collapsible section is expanded' },
    { name: 'aria-selected', desc: 'Whether the element is selected' },
    { name: 'aria-checked', desc: 'Whether the element is checked (ARIA)' },
    { name: 'aria-describedby', desc: 'ID of element(s) that describe this element' },
    { name: 'aria-labelledby', desc: 'ID of element(s) that label this element' },
    { name: 'aria-live', desc: 'Live region update mode (off, polite, assertive)' },
    { name: 'aria-controls', desc: 'ID of element(s) controlled by this element' },
    { name: 'aria-haspopup', desc: 'Whether the element triggers a popup' },
];

/** Tag-specific HTML attribute maps with descriptions */
const TAG_ATTRIBUTES: Record<string, NamedDesc[]> = {
    HTMLVideoElement: [
        { name: 'src', desc: 'URL of the video resource' },
        { name: 'poster', desc: 'URL of an image to show before playback' },
        { name: 'width', desc: 'Width of the video player in pixels' },
        { name: 'height', desc: 'Height of the video player in pixels' },
        { name: 'autoplay', desc: 'Whether to start playback automatically' },
        { name: 'controls', desc: 'Whether to show playback controls' },
        { name: 'loop', desc: 'Whether to loop playback' },
        { name: 'muted', desc: 'Whether audio is muted by default' },
        { name: 'preload', desc: 'Preload hint (none, metadata, auto)' },
        { name: 'playsinline', desc: 'Whether to play inline on iOS' },
        { name: 'crossorigin', desc: 'CORS setting for the resource (anonymous, use-credentials)' },
    ],
    HTMLAudioElement: [
        { name: 'src', desc: 'URL of the audio resource' },
        { name: 'autoplay', desc: 'Whether to start playback automatically' },
        { name: 'controls', desc: 'Whether to show playback controls' },
        { name: 'loop', desc: 'Whether to loop playback' },
        { name: 'muted', desc: 'Whether audio is muted by default' },
        { name: 'preload', desc: 'Preload hint (none, metadata, auto)' },
        { name: 'crossorigin', desc: 'CORS setting for the resource' },
    ],
    HTMLInputElement: [
        { name: 'type', desc: 'Type of input (text, number, checkbox, radio, etc.)' },
        { name: 'name', desc: 'Name of the input for form submission' },
        { name: 'value', desc: 'Current value of the input' },
        { name: 'placeholder', desc: 'Placeholder text when empty' },
        { name: 'disabled', desc: 'Whether the input is disabled' },
        { name: 'readonly', desc: 'Whether the input is read-only' },
        { name: 'required', desc: 'Whether the input must be filled before submission' },
        { name: 'checked', desc: 'Whether checkbox/radio is checked' },
        { name: 'min', desc: 'Minimum value for numeric/date inputs' },
        { name: 'max', desc: 'Maximum value for numeric/date inputs' },
        { name: 'step', desc: 'Step increment for numeric inputs' },
        { name: 'pattern', desc: 'Regex pattern for validation' },
        { name: 'maxlength', desc: 'Maximum number of characters allowed' },
        { name: 'minlength', desc: 'Minimum number of characters required' },
        { name: 'size', desc: 'Width of the input in characters' },
        { name: 'autocomplete', desc: 'Whether to enable browser autocomplete' },
        { name: 'autofocus', desc: 'Whether to focus the input on page load' },
        { name: 'multiple', desc: 'Whether multiple values are allowed (email, file)' },
        { name: 'accept', desc: 'Accepted file types for file inputs' },
        { name: 'list', desc: 'ID of a datalist element for suggestions' },
        { name: 'form', desc: 'ID of the associated form element' },
        { name: 'formaction', desc: 'URL to submit to (overrides form action)' },
        { name: 'formmethod', desc: 'HTTP method for submission (overrides form method)' },
        { name: 'inputmode', desc: 'Virtual keyboard hint (numeric, tel, email, etc.)' },
    ],
    HTMLSelectElement: [
        { name: 'name', desc: 'Name of the select for form submission' },
        { name: 'disabled', desc: 'Whether the select is disabled' },
        { name: 'required', desc: 'Whether a selection is required' },
        { name: 'multiple', desc: 'Whether multiple options can be selected' },
        { name: 'size', desc: 'Number of visible options' },
        { name: 'autocomplete', desc: 'Whether to enable browser autocomplete' },
        { name: 'autofocus', desc: 'Whether to focus on page load' },
        { name: 'form', desc: 'ID of the associated form element' },
    ],
    HTMLTextAreaElement: [
        { name: 'name', desc: 'Name of the textarea for form submission' },
        { name: 'placeholder', desc: 'Placeholder text when empty' },
        { name: 'disabled', desc: 'Whether the textarea is disabled' },
        { name: 'readonly', desc: 'Whether the textarea is read-only' },
        { name: 'required', desc: 'Whether the textarea must be filled' },
        { name: 'rows', desc: 'Number of visible text rows' },
        { name: 'cols', desc: 'Number of visible text columns' },
        { name: 'maxlength', desc: 'Maximum number of characters allowed' },
        { name: 'minlength', desc: 'Minimum number of characters required' },
        { name: 'wrap', desc: 'How text wraps on submission (soft, hard)' },
        { name: 'autocomplete', desc: 'Whether to enable browser autocomplete' },
        { name: 'autofocus', desc: 'Whether to focus on page load' },
        { name: 'form', desc: 'ID of the associated form element' },
    ],
    HTMLCanvasElement: [
        { name: 'width', desc: 'Width of the canvas in pixels' },
        { name: 'height', desc: 'Height of the canvas in pixels' },
    ],
    HTMLAnchorElement: [
        { name: 'href', desc: 'URL of the linked resource' },
        { name: 'target', desc: 'Browsing context for the link (_blank, _self, etc.)' },
        { name: 'rel', desc: 'Relationship of the linked resource (noopener, noreferrer, etc.)' },
        { name: 'download', desc: 'Download filename instead of navigating' },
        { name: 'hreflang', desc: 'Language of the linked resource' },
        { name: 'type', desc: 'MIME type of the linked resource' },
        { name: 'referrerpolicy', desc: 'Referrer policy for the link' },
        { name: 'ping', desc: 'Space-separated URLs to ping on click' },
    ],
    HTMLImageElement: [
        { name: 'src', desc: 'URL of the image' },
        { name: 'alt', desc: 'Alternative text description' },
        { name: 'width', desc: 'Width of the image in pixels' },
        { name: 'height', desc: 'Height of the image in pixels' },
        { name: 'loading', desc: 'Loading strategy (lazy, eager)' },
        { name: 'decoding', desc: 'Decoding hint (async, sync, auto)' },
        { name: 'srcset', desc: 'Responsive image source set' },
        { name: 'sizes', desc: 'Image sizes for responsive images' },
        { name: 'crossorigin', desc: 'CORS setting for the image' },
        { name: 'referrerpolicy', desc: 'Referrer policy for the image' },
        { name: 'usemap', desc: 'Name of the associated image map' },
        { name: 'ismap', desc: 'Whether the image is a server-side image map' },
    ],
    HTMLFormElement: [
        { name: 'action', desc: 'URL to submit form data to' },
        { name: 'method', desc: 'HTTP method (GET, POST)' },
        { name: 'enctype', desc: 'Encoding type for form data' },
        { name: 'target', desc: 'Browsing context for the form response' },
        { name: 'autocomplete', desc: 'Whether to enable autocomplete for form fields' },
        { name: 'novalidate', desc: 'Whether to skip validation on submit' },
        { name: 'name', desc: 'Name of the form' },
        { name: 'accept-charset', desc: 'Character encodings for form submission' },
    ],
    HTMLDialogElement: [
        { name: 'open', desc: 'Whether the dialog is open' },
    ],
    HTMLButtonElement: [
        { name: 'type', desc: 'Type of button (submit, reset, button)' },
        { name: 'name', desc: 'Name of the button for form submission' },
        { name: 'value', desc: 'Value submitted with form data' },
        { name: 'disabled', desc: 'Whether the button is disabled' },
        { name: 'autofocus', desc: 'Whether to focus on page load' },
        { name: 'form', desc: 'ID of the associated form element' },
        { name: 'formaction', desc: 'URL to submit to (overrides form)' },
        { name: 'formmethod', desc: 'HTTP method (overrides form)' },
        { name: 'formnovalidate', desc: 'Skip validation (overrides form)' },
        { name: 'formtarget', desc: 'Browsing context for response (overrides form)' },
        { name: 'formenctype', desc: 'Encoding type (overrides form)' },
    ],
    HTMLIFrameElement: [
        { name: 'src', desc: 'URL of the iframe page' },
        { name: 'srcdoc', desc: 'Inline HTML content for the iframe' },
        { name: 'name', desc: 'Name of the iframe for targeting' },
        { name: 'sandbox', desc: 'Security restrictions for the iframe' },
        { name: 'allow', desc: 'Permissions policy for the iframe' },
        { name: 'width', desc: 'Width of the iframe' },
        { name: 'height', desc: 'Height of the iframe' },
        { name: 'loading', desc: 'Loading strategy (lazy, eager)' },
        { name: 'referrerpolicy', desc: 'Referrer policy for the iframe' },
    ],
    HTMLDetailsElement: [
        { name: 'open', desc: 'Whether the details are expanded' },
    ],
    HTMLMeterElement: [
        { name: 'value', desc: 'Current numeric value' },
        { name: 'min', desc: 'Minimum value of the range' },
        { name: 'max', desc: 'Maximum value of the range' },
        { name: 'low', desc: 'Upper bound of the low range' },
        { name: 'high', desc: 'Lower bound of the high range' },
        { name: 'optimum', desc: 'Optimal value within the range' },
    ],
    HTMLProgressElement: [
        { name: 'value', desc: 'Current progress value' },
        { name: 'max', desc: 'Maximum value (completion)' },
    ],
    HTMLSlotElement: [
        { name: 'name', desc: 'Name of the slot for content distribution' },
    ],
    HTMLTableElement: [
        { name: 'border', desc: 'Width of the table border' },
    ],
    HTMLTableCellElement: [
        { name: 'colspan', desc: 'Number of columns the cell spans' },
        { name: 'rowspan', desc: 'Number of rows the cell spans' },
        { name: 'headers', desc: 'IDs of related header cells' },
        { name: 'scope', desc: 'Scope of the header cell (row, col, rowgroup, colgroup)' },
    ],
    HTMLOptionElement: [
        { name: 'value', desc: 'Value submitted when this option is selected' },
        { name: 'label', desc: 'Label text for the option' },
        { name: 'disabled', desc: 'Whether the option is disabled' },
        { name: 'selected', desc: 'Whether the option is selected by default' },
    ],
    HTMLFieldSetElement: [
        { name: 'disabled', desc: 'Whether all controls in the fieldset are disabled' },
        { name: 'name', desc: 'Name of the fieldset' },
        { name: 'form', desc: 'ID of the associated form element' },
    ],
    HTMLOutputElement: [
        { name: 'name', desc: 'Name of the output for form submission' },
        { name: 'for', desc: 'IDs of related form controls' },
        { name: 'form', desc: 'ID of the associated form element' },
    ],
    HTMLLabelElement: [
        { name: 'for', desc: 'ID of the form control this label is for' },
    ],
    HTMLObjectElement: [
        { name: 'data', desc: 'URL of the embedded resource' },
        { name: 'type', desc: 'MIME type of the resource' },
        { name: 'name', desc: 'Name of the object for targeting' },
        { name: 'width', desc: 'Width of the object' },
        { name: 'height', desc: 'Height of the object' },
        { name: 'form', desc: 'ID of the associated form element' },
    ],
    HTMLEmbedElement: [
        { name: 'src', desc: 'URL of the embedded resource' },
        { name: 'type', desc: 'MIME type of the resource' },
        { name: 'width', desc: 'Width of the embed' },
        { name: 'height', desc: 'Height of the embed' },
    ],
    HTMLOptGroupElement: [
        { name: 'disabled', desc: 'Whether the option group is disabled' },
        { name: 'label', desc: 'Label for the option group' },
    ],
    HTMLOListElement: [
        { name: 'start', desc: 'Starting number for the list' },
        { name: 'reversed', desc: 'Whether the list is numbered in reverse' },
        { name: 'type', desc: 'Numbering type (1, a, A, i, I)' },
    ],
    HTMLLIElement: [
        { name: 'value', desc: 'Ordinal value of the list item' },
    ],
    HTMLTrackElement: [
        { name: 'kind', desc: 'Kind of text track (subtitles, captions, descriptions, chapters, metadata)' },
        { name: 'src', desc: 'URL of the track file' },
        { name: 'srclang', desc: 'Language of the track text' },
        { name: 'label', desc: 'User-readable label for the track' },
        { name: 'default', desc: 'Whether this is the default track' },
    ],
    HTMLSourceElement: [
        { name: 'src', desc: 'URL of the media resource' },
        { name: 'type', desc: 'MIME type of the resource' },
        { name: 'srcset', desc: 'Responsive image source set' },
        { name: 'sizes', desc: 'Image sizes for responsive images' },
        { name: 'media', desc: 'Media query for the source' },
    ],
    HTMLLinkElement: [
        { name: 'href', desc: 'URL of the linked resource' },
        { name: 'rel', desc: 'Relationship (stylesheet, icon, preload, etc.)' },
        { name: 'type', desc: 'MIME type of the linked resource' },
        { name: 'media', desc: 'Media query for conditional loading' },
        { name: 'crossorigin', desc: 'CORS setting for the resource' },
        { name: 'referrerpolicy', desc: 'Referrer policy for the link' },
        { name: 'as', desc: 'Resource type hint for preloading' },
        { name: 'disabled', desc: 'Whether the linked stylesheet is disabled' },
    ],
    HTMLDataElement: [
        { name: 'value', desc: 'Machine-readable value' },
    ],
    HTMLTimeElement: [
        { name: 'datetime', desc: 'Machine-readable date/time value' },
    ],
    HTMLQuoteElement: [
        { name: 'cite', desc: 'URL of the quote source' },
    ],
};

/** Global DOM properties applicable to all elements */
const GLOBAL_DOM_PROPERTIES: NamedDesc[] = [
    { name: 'textContent', desc: 'Text content of the element and its descendants' },
    { name: 'innerHTML', desc: 'HTML markup of the element\'s content' },
    { name: 'hidden', desc: 'Whether the element is hidden' },
    { name: 'tabIndex', desc: 'Tab order position of the element' },
    { name: 'title', desc: 'Advisory text (tooltip) for the element' },
    { name: 'className', desc: 'Space-separated list of CSS class names' },
    { name: 'id', desc: 'Unique identifier for the element' },
    { name: 'draggable', desc: 'Whether the element is draggable' },
    { name: 'contentEditable', desc: 'Whether the element content is editable' },
];

/**
 * Get HTML attribute names with descriptions for a specific element type (for nb-attr completions).
 * Returns tag-specific attributes combined with global attributes.
 */
export function getTagSpecificAttributes(elementType: string): NamedDesc[] {
    const tagAttrs = TAG_ATTRIBUTES[elementType] || [];
    return [...tagAttrs, ...GLOBAL_HTML_ATTRIBUTES];
}

/**
 * Get DOM property names with descriptions for a specific element type (for nb-prop completions).
 * Returns tag-specific properties combined with global properties.
 */
export function getTagSpecificProperties(elementType: string): NamedDesc[] {
    const members = getTagSpecificMembers(elementType);
    const props: NamedDesc[] = members
        .filter(m => m.kind === 'property')
        .map(m => ({ name: m.name, desc: m.desc }));
    return [...props, ...GLOBAL_DOM_PROPERTIES];
}

// ─── DOM element member info (for nativeElement hover & completions) ───────

const DOM_ELEMENT_MEMBERS: Record<string, MemberInfo> = {
    id:                     { type: 'string',                desc: 'The `id` attribute of the element',                                         kind: 'property' },
    className:              { type: 'string',                desc: 'Space-separated CSS class names (reflects the `class` attribute)',            kind: 'property' },
    classList:              { type: 'DOMTokenList',          desc: 'Live token list for adding, removing, and toggling CSS classes',              kind: 'property' },
    tagName:                { type: 'string',                desc: 'Tag name in uppercase (e.g. `"DIV"`, `"SPAN"`)',                             kind: 'property' },
    innerHTML:              { type: 'string',                desc: 'HTML markup of child content — setting it re-parses the subtree',             kind: 'property' },
    outerHTML:              { type: 'string',                desc: 'The element\'s full HTML including its own opening and closing tags',          kind: 'property' },
    textContent:            { type: 'string | null',         desc: 'Text content of the element and all descendants, with markup stripped',       kind: 'property' },
    children:               { type: 'HTMLCollection',        desc: 'Live collection of direct child **elements** (excludes text/comment nodes)',  kind: 'property' },
    childElementCount:      { type: 'number',                desc: 'Number of direct child elements',                                            kind: 'property' },
    firstElementChild:      { type: 'Element | null',        desc: 'First child element, or `null` if none',                                     kind: 'property' },
    lastElementChild:       { type: 'Element | null',        desc: 'Last child element, or `null` if none',                                      kind: 'property' },
    parentElement:          { type: 'Element | null',        desc: 'Parent element in the DOM tree, or `null` if detached',                      kind: 'property' },
    nextElementSibling:     { type: 'Element | null',        desc: 'Next sibling element, or `null` if this is the last child',                  kind: 'property' },
    previousElementSibling: { type: 'Element | null',        desc: 'Previous sibling element, or `null` if this is the first child',             kind: 'property' },
    style:                  { type: 'CSSStyleDeclaration',   desc: 'Inline style object — read/write individual CSS properties directly',        kind: 'property' },
    dataset:                { type: 'DOMStringMap',          desc: 'Read/write `data-*` attributes as camelCase properties',                     kind: 'property' },
    hidden:                 { type: 'boolean',               desc: 'Whether the element is hidden (reflects the `hidden` HTML attribute)',        kind: 'property' },
    tabIndex:               { type: 'number',                desc: 'Tab order position; `-1` removes from tab sequence, `0` adds in DOM order',  kind: 'property' },
    title:                  { type: 'string',                desc: 'Advisory text shown as a tooltip on hover (reflects the `title` attribute)',  kind: 'property' },
    draggable:              { type: 'boolean',               desc: 'Whether the element participates in drag-and-drop',                          kind: 'property' },
    contentEditable:        { type: 'string',                desc: 'Editability state: `"true"`, `"false"`, or `"inherit"`',                     kind: 'property' },
    dir:                    { type: 'string',                desc: 'Text directionality: `"ltr"`, `"rtl"`, or `"auto"`',                         kind: 'property' },
    slot:                   { type: 'string',                desc: 'Name of the shadow-DOM slot this element is assigned to',                    kind: 'property' },
    clientWidth:            { type: 'number',                desc: 'Inner width (px) including padding but excluding borders and scrollbar',      kind: 'property' },
    clientHeight:           { type: 'number',                desc: 'Inner height (px) including padding but excluding borders and scrollbar',     kind: 'property' },
    clientTop:              { type: 'number',                desc: 'Width (px) of the top border',                                               kind: 'property' },
    clientLeft:             { type: 'number',                desc: 'Width (px) of the left border',                                              kind: 'property' },
    scrollTop:              { type: 'number',                desc: 'Pixels scrolled vertically — settable to programmatically scroll',            kind: 'property' },
    scrollLeft:             { type: 'number',                desc: 'Pixels scrolled horizontally — settable to programmatically scroll',          kind: 'property' },
    scrollWidth:            { type: 'number',                desc: 'Total scrollable width including overflow (px)',                              kind: 'property' },
    scrollHeight:           { type: 'number',                desc: 'Total scrollable height including overflow (px)',                             kind: 'property' },
    offsetTop:              { type: 'number',                desc: 'Distance (px) from the top of `offsetParent`',                               kind: 'property' },
    offsetLeft:             { type: 'number',                desc: 'Distance (px) from the left of `offsetParent`',                              kind: 'property' },
    offsetWidth:            { type: 'number',                desc: 'Layout width (px) including padding, borders, and scrollbar',                 kind: 'property' },
    offsetHeight:           { type: 'number',                desc: 'Layout height (px) including padding, borders, and scrollbar',                kind: 'property' },
    offsetParent:           { type: 'Element | null',        desc: 'Nearest positioned ancestor used for offset calculations',                   kind: 'property' },
    isConnected:            { type: 'boolean',               desc: 'Whether the element is connected to the document DOM tree',                  kind: 'property' },
    getAttribute:           { type: '(name: string) => string | null',          desc: 'Returns the value of the specified attribute, or `null` if absent',    kind: 'method' },
    setAttribute:           { type: '(name: string, value: string) => void',    desc: 'Sets the value of an attribute; creates it if it doesn\'t exist',      kind: 'method' },
    removeAttribute:        { type: '(name: string) => void',                   desc: 'Removes the specified attribute from the element',                     kind: 'method' },
    hasAttribute:           { type: '(name: string) => boolean',                desc: 'Returns `true` if the element has the specified attribute',            kind: 'method' },
    toggleAttribute:        { type: '(name: string, force?: boolean) => boolean', desc: 'Toggles a boolean attribute; returns `true` if now present',        kind: 'method' },
    querySelector:          { type: '(selector: string) => Element | null',     desc: 'Returns the first descendant matching the CSS selector, or `null`',   kind: 'method' },
    querySelectorAll:       { type: '(selector: string) => NodeListOf<Element>',desc: 'Returns all descendants matching the CSS selector',                   kind: 'method' },
    closest:                { type: '(selector: string) => Element | null',     desc: 'Walks up the ancestor chain and returns the first element matching the selector', kind: 'method' },
    matches:                { type: '(selector: string) => boolean',            desc: 'Returns `true` if the element would be selected by the given CSS selector',       kind: 'method' },
    getBoundingClientRect:  { type: '() => DOMRect',                            desc: 'Returns size and position relative to the viewport (top, left, width, height)',    kind: 'method' },
    getClientRects:         { type: '() => DOMRectList',                        desc: 'Returns a collection of DOMRect objects for each CSS border box of the element',  kind: 'method' },
    scroll:                 { type: '(x: number, y: number) => void',           desc: 'Scrolls the element to the specified coordinates',                    kind: 'method' },
    scrollTo:               { type: '(x: number, y: number) => void',           desc: 'Scrolls the element to the specified coordinates (alias of `scroll`)',kind: 'method' },
    scrollBy:               { type: '(x: number, y: number) => void',           desc: 'Scrolls the element by the given delta from its current position',   kind: 'method' },
    scrollIntoView:         { type: '(arg?: boolean | ScrollIntoViewOptions) => void', desc: 'Scrolls the element into the visible area of its scroll container', kind: 'method' },
    addEventListener:       { type: '(type: string, listener: EventListener) => void', desc: 'Registers an event listener on the element',                  kind: 'method' },
    removeEventListener:    { type: '(type: string, listener: EventListener) => void', desc: 'Removes a previously registered event listener',              kind: 'method' },
    dispatchEvent:          { type: '(event: Event) => boolean',                desc: 'Dispatches an event to the element and returns `false` if cancelled', kind: 'method' },
    remove:                 { type: '() => void',                               desc: 'Removes the element from its parent in the DOM',                     kind: 'method' },
    focus:                  { type: '(options?: FocusOptions) => void',          desc: 'Moves keyboard focus to the element',                                kind: 'method' },
    blur:                   { type: '() => void',                               desc: 'Removes keyboard focus from the element',                            kind: 'method' },
    click:                  { type: '() => void',                               desc: 'Simulates a mouse click on the element',                             kind: 'method' },
    animate:                { type: '(keyframes: Keyframe[], options?: number | KeyframeAnimationOptions) => Animation', desc: 'Creates and plays a CSS animation', kind: 'method' },
    append:                 { type: '(...nodes: (Node | string)[]) => void',    desc: 'Inserts nodes after the last child of this element',                  kind: 'method' },
    prepend:                { type: '(...nodes: (Node | string)[]) => void',    desc: 'Inserts nodes before the first child of this element',                kind: 'method' },
    replaceChildren:        { type: '(...nodes: (Node | string)[]) => void',    desc: 'Replaces all children with the given nodes',                          kind: 'method' },
    insertAdjacentHTML:     { type: '(position: InsertPosition, text: string) => void', desc: 'Parses HTML and inserts at `beforebegin`, `afterbegin`, `beforeend`, or `afterend`', kind: 'method' },
    insertAdjacentElement:  { type: '(position: InsertPosition, element: Element) => Element | null', desc: 'Inserts an element at the specified position relative to this element', kind: 'method' },
    cloneNode:              { type: '(deep?: boolean) => Node',                 desc: 'Returns a copy of the node; pass `true` for a deep clone with descendants', kind: 'method' },
    contains:               { type: '(node: Node | null) => boolean',           desc: 'Returns `true` if the given node is a descendant (or the element itself)',  kind: 'method' },
};

/**
 * Enumerate every DOM-Element member visible on `nativeElement` for a given
 * tag's element type — tag-specific first, then global. Used by completions.
 */
export function getAllDomElementMembers(elementType?: string): Array<{ name: string } & MemberInfo> {
    const seen = new Set<string>();
    const out: Array<{ name: string } & MemberInfo> = [];
    if (elementType) {
        for (const m of getTagSpecificMembers(elementType)) {
            if (!seen.has(m.name)) {
                seen.add(m.name);
                out.push({ name: m.name, type: m.type, desc: m.desc, kind: m.kind });
            }
        }
    }
    for (const name of Object.keys(DOM_ELEMENT_MEMBERS)) {
        if (!seen.has(name)) { seen.add(name); out.push({ name, ...DOM_ELEMENT_MEMBERS[name] }); }
    }
    return out;
}

/**
 * Look up a single DOM Element member by name (for nativeElement.X hover).
 * Also checks tag-specific members if elementType is provided.
 */
export function getDomMemberInfo(memberName: string, elementType?: string): MemberInfo | undefined {
    if (elementType) {
        const tagMembers = getTagSpecificMembers(elementType);
        const tagMember = tagMembers.find(m => m.name === memberName);
        if (tagMember) {
            return { type: tagMember.type, desc: tagMember.desc, kind: tagMember.kind === 'method' ? 'method' : 'property' };
        }
    }
    return DOM_ELEMENT_MEMBERS[memberName];
}
